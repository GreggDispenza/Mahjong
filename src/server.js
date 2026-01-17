// Main Server - Express + Socket.IO
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import MahjongDB from './database.js';
import { MahjongGame } from './game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable required');
  process.exit(1);
}

// AI Chat state
const aiChatCooldown = new Map(); // roomCode -> lastResponseTime

// Initialize
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { 
    origin: process.env.ALLOWED_ORIGIN || 'https://mahjong-owe1.onrender.com',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const db = new MahjongDB();
const games = new Map();
const playerSockets = new Map();
const socketUsers = new Map();

// Middleware
app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Simple rate limiter
const rateLimits = new Map();
function rateLimit(key, maxRequests = 30, windowMs = 60000) {
  const now = Date.now();
  const record = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count++;
  rateLimits.set(key, record);
  return record.count > maxRequests;
}

// Sanitize input
function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>]/g, '');
}

// CORS
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://mahjong-owe1.onrender.com';
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Generate room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ==================== REST API ====================

app.post('/api/register', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (rateLimit(`register:${ip}`, 5, 300000)) { // 5 per 5 min
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (displayName.length > 30) return res.status(400).json({ error: 'Display name too long' });

  const cleanUsername = sanitize(username, 20);
  const cleanDisplayName = sanitize(displayName, 30);
  
  const result = await db.createUser(cleanUsername, password, cleanDisplayName);
  if (result.success) {
    const token = jwt.sign({ id: result.userId, username: cleanUsername, displayName: cleanDisplayName }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: result.userId, username: cleanUsername, displayName: cleanDisplayName } });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.post('/api/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (rateLimit(`login:${ip}`, 10, 60000)) { // 10 per minute
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const result = await db.authenticateUser(username, password);
  if (result.success) {
    const token = jwt.sign(
      { id: result.user.id, username: result.user.username, displayName: result.user.displayName },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: result.user });
  } else {
    // Generic error to prevent username enumeration
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  const stats = db.getPlayerStats(req.user.id);
  res.json({ user, stats });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = db.getLeaderboard(50, req.query.sort || 'total_score');
  res.json(leaderboard);
});

app.get('/api/history/:userId', (req, res) => {
  const history = db.getPlayerHistory(parseInt(req.params.userId), 50);
  res.json(history);
});

app.get('/api/online', (req, res) => {
  res.json(db.getOnlinePlayers());
});

// Get lobbies - with debug logging
app.get('/api/lobbies', (req, res) => {
  const lobbies = [];
  console.log(`📋 /api/lobbies called. Total games in Map: ${games.size}`);
  for (const [code, game] of games) {
    console.log(`   - Room ${code}: phase=${game.phase}, players=${game.playerOrder.length}`);
    if (game.phase === 'waiting') {
      lobbies.push({
        roomCode: code,
        playerCount: game.playerOrder.length,
        players: game.getPlayersInfo(),
        createdAt: game.createdAt
      });
    }
  }
  console.log(`📋 Returning ${lobbies.length} lobbies`);
  res.json(lobbies);
});

// Debug endpoint - only in development
app.get('/api/debug', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const info = {
    gamesCount: games.size,
    games: Array.from(games.entries()).map(([code, g]) => ({
      code,
      phase: g.phase,
      players: g.playerOrder.length
    })),
    socketsCount: socketUsers.size
  };
  res.json(info);
});

// DeepSeek AI Chat
async function getAIResponse(roomCode, chatHistory, game) {
  // Cooldown: 1 response per 15 seconds per room
  const now = Date.now();
  const lastResponse = aiChatCooldown.get(roomCode) || 0;
  if (now - lastResponse < 15000) return null;
  
  // 40% chance to respond (save tokens)
  if (Math.random() > 0.4) return null;

  const aiNames = Array.from(game.aiPlayers).map(id => game.players[id]?.displayName).filter(Boolean);
  if (aiNames.length === 0) return null;

  const aiName = aiNames[Math.floor(Math.random() * aiNames.length)];
  const recentChat = chatHistory.slice(-5).map(m => `${m.name}: ${m.text}`).join('\n');

  const prompt = `You are ${aiName}, an AI mahjong player. You're playing mahjong with humans.

Recent chat:
${recentChat}

Respond naturally in 1 short sentence. Match the language used (English/Chinese/mixed). Be playful - you can trash talk, joke, encourage, or react to what was said. Keep it fun and brief. Just the message, no name prefix.`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 0.9
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    
    if (reply) {
      aiChatCooldown.set(roomCode, now);
      return { name: aiName, text: reply };
    }
  } catch (err) {
    console.error('DeepSeek error:', err.message);
  }
  return null;
}

// Chat history storage
const roomChatHistory = new Map(); // roomCode -> [{name, text}]

// AI game event reactions (simpler, no API call needed)
function getAIReaction(eventType, aiName) {
  const reactions = {
    pung: ['碰！', 'Pung!', '碰碰碰~', '哈哈碰到了', 'Got it! 碰!', '這張我要了'],
    kong: ['槓！大四喜！', 'Kong! 💪', '槓！爽！', '四張都我的', 'Kong kong kong~'],
    chow: ['吃！', 'Chow~', '謝謝餵牌', '吃吃吃', 'Yum yum 吃!'],
    discard: ['出牌~', '打這張', '不要了', 'Your turn~', '下一個'],
    win: ['胡了！！！', 'Mahjong! 🎉', '我贏了哈哈', 'GG 胡牌！', '謝謝各位～']
  };
  
  // 25% chance to react
  if (Math.random() > 0.25) return null;
  
  const options = reactions[eventType] || [];
  if (options.length === 0) return null;
  
  return {
    name: aiName,
    text: options[Math.floor(Math.random() * options.length)]
  };
}

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);
  let currentUser = null;
  let currentRoom = null;

  socket.on('auth', (token, callback) => {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      currentUser = user;
      socketUsers.set(socket.id, user);
      playerSockets.set(user.id, socket.id);
      db.setUserOnline(user.id, true);
      io.emit('playerOnline', { id: user.id, displayName: user.displayName });
      callback({ success: true, user });
      console.log(`✅ Auth: ${user.displayName} (socket: ${socket.id})`);
    } catch (err) {
      callback({ success: false, error: 'Invalid token' });
    }
  });

  socket.on('createRoom', (callback) => {
    if (!currentUser) {
      console.log('❌ createRoom failed: not authenticated');
      return callback({ success: false, error: 'Not authenticated' });
    }

    let roomCode;
    do { roomCode = generateRoomCode(); } while (games.has(roomCode));

    const game = new MahjongGame(roomCode);
    const result = game.addPlayer(socket.id, currentUser.id, currentUser.displayName);

    if (result.success) {
      games.set(roomCode, game);
      socket.join(roomCode);
      currentRoom = roomCode;

      console.log(`🎮 Room ${roomCode} created by ${currentUser.displayName}. Total games: ${games.size}`);

      callback({
        success: true,
        roomCode,
        seatWind: result.seatWind,
        players: game.getPlayersInfo()
      });

      io.emit('lobbyCreated', {
        roomCode,
        playerCount: 1,
        players: game.getPlayersInfo()
      });
    } else {
      callback(result);
    }
  });

  socket.on('joinRoom', (roomCode, callback) => {
    if (!currentUser) {
      console.log('❌ joinRoom failed: not authenticated');
      return callback({ success: false, error: 'Not authenticated' });
    }

    roomCode = roomCode.toUpperCase().trim();
    console.log(`🚪 Join attempt: ${currentUser.displayName} -> ${roomCode}`);
    console.log(`   Available rooms: ${Array.from(games.keys()).join(', ') || 'none'}`);

    const game = games.get(roomCode);

    if (!game) {
      console.log(`❌ Room ${roomCode} not found`);
      return callback({ success: false, error: 'Room not found' });
    }
    if (game.phase !== 'waiting') {
      console.log(`❌ Room ${roomCode} game in progress`);
      return callback({ success: false, error: 'Game in progress' });
    }

    const result = game.addPlayer(socket.id, currentUser.id, currentUser.displayName);

    if (result.success) {
      socket.join(roomCode);
      currentRoom = roomCode;

      socket.to(roomCode).emit('playerJoined', {
        oderId: currentUser.id,
        displayName: currentUser.displayName,
        seatWind: result.seatWind,
        players: game.getPlayersInfo()
      });

      callback({
        success: true,
        roomCode,
        seatWind: result.seatWind,
        players: game.getPlayersInfo()
      });

      io.emit('lobbyUpdated', {
        roomCode,
        playerCount: result.playerCount,
        players: game.getPlayersInfo()
      });

      if (game.canStart()) {
        io.to(roomCode).emit('readyToStart', { players: game.getPlayersInfo() });
      }

      console.log(`✅ ${currentUser.displayName} joined ${roomCode} (${result.playerCount}/4)`);
    } else {
      callback(result);
    }
  });

  socket.on('startGame', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    // Add AI players if needed
    if (game.playerOrder.length < 4) {
      game.addAIPlayers();
      io.to(currentRoom).emit('playersUpdated', { players: game.getPlayersInfo() });
    }

    const result = game.startGame();
    if (result.success) {
      game.gameId = db.createGame(currentRoom);
      for (const pid of game.playerOrder) {
        if (!game.aiPlayers.has(pid)) {
          io.to(pid).emit('gameStarted', game.getStateForPlayer(pid));
        }
      }
      io.emit('lobbyRemoved', { roomCode: currentRoom });
      callback({ success: true });
      console.log(`🎲 Game started: ${currentRoom} (AI players: ${game.aiPlayers.size})`);

      // If first player is AI, start AI turn
      if (game.isCurrentPlayerAI()) {
        setTimeout(() => processAITurn(currentRoom), 1500);
      }
    } else {
      callback(result);
    }
  });

  // AI Turn Processing
  function processAITurn(roomCode) {
    const game = games.get(roomCode);
    if (!game || game.phase !== 'playing') return;

    const currentPlayer = game.getCurrentPlayer();
    if (!game.aiPlayers.has(currentPlayer)) return;

    // Check if AI can win
    if (game.isWinningHand(game.players[currentPlayer].hand, game.players[currentPlayer].exposed)) {
      const result = game.declareMahjong(currentPlayer, false);
      if (result.success) {
        const aiPlayer = game.players[currentPlayer];
        io.to(roomCode).emit('gameWon', {
          winnerId: aiPlayer.oderId,
          winnerName: aiPlayer.displayName,
          score: result.score,
          hand: result.hand,
          exposed: result.exposed
        });
        return;
      }
    }

    // AI discards
    const tileId = game.aiSelectDiscard(currentPlayer);
    if (tileId !== null) {
      const discardResult = game.discard(currentPlayer, tileId);
      if (discardResult.success) {
        io.to(roomCode).emit('tileDiscarded', { oderId: game.players[currentPlayer].oderId, tile: discardResult.tile });
        for (const pid of game.playerOrder) {
          if (!game.aiPlayers.has(pid)) {
            io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
          }
        }

        // Wait for human claims, then process AI claims or next turn
        setTimeout(() => processAfterDiscard(roomCode), 2000);
      }
    }
  }

  function processAfterDiscard(roomCode) {
    const game = games.get(roomCode);
    if (!game || game.phase !== 'playing' || !game.lastDiscard) {
      // Discard was claimed by human, do nothing
      return;
    }

    // Check AI claims (priority: mahjong > kong > pung > chow)
    for (const aiId of game.aiPlayers) {
      if (game.aiShouldClaim(aiId, 'mahjong')) {
        const result = game.declareMahjong(aiId, true);
        if (result.success) {
          const aiPlayer = game.players[aiId];
          io.to(roomCode).emit('gameWon', {
            winnerId: aiPlayer.oderId,
            winnerName: aiPlayer.displayName,
            score: result.score,
            hand: result.hand,
            exposed: result.exposed
          });
          return;
        }
      }
    }

    for (const aiId of game.aiPlayers) {
      if (game.aiShouldClaim(aiId, 'kong')) {
        const result = game.claimKong(aiId);
        if (result.success) {
          const aiPlayer = game.players[aiId];
          io.to(roomCode).emit('meldClaimed', { oderId: aiPlayer.oderId, type: 'kong', meld: result.meld });
          
          // AI reaction
          const reaction = getAIReaction('kong', aiPlayer.displayName);
          if (reaction) {
            setTimeout(() => {
              io.to(roomCode).emit('chat', { displayName: reaction.name, message: reaction.text, timestamp: Date.now(), isAI: true });
            }, 500);
          }
          
          broadcastState(roomCode, game);
          setTimeout(() => processAITurn(roomCode), 1500);
          return;
        }
      }
    }

    for (const aiId of game.aiPlayers) {
      if (game.aiShouldClaim(aiId, 'pung')) {
        const result = game.claimPung(aiId);
        if (result.success) {
          const aiPlayer = game.players[aiId];
          io.to(roomCode).emit('meldClaimed', { oderId: aiPlayer.oderId, type: 'pung', meld: result.meld });
          
          // AI reaction
          const reaction = getAIReaction('pung', aiPlayer.displayName);
          if (reaction) {
            setTimeout(() => {
              io.to(roomCode).emit('chat', { displayName: reaction.name, message: reaction.text, timestamp: Date.now(), isAI: true });
            }, 500);
          }
          
          broadcastState(roomCode, game);
          setTimeout(() => processAITurn(roomCode), 1500);
          return;
        }
      }
    }

    // Check chow for next player if AI
    const nextPlayer = game.playerOrder[(game.currentTurn + 1) % 4];
    if (game.aiPlayers.has(nextPlayer) && game.aiShouldClaim(nextPlayer, 'chow')) {
      const chowTiles = game.getAIChowTiles(nextPlayer);
      if (chowTiles) {
        const result = game.claimChow(nextPlayer, chowTiles);
        if (result.success) {
          io.to(roomCode).emit('meldClaimed', { oderId: game.players[nextPlayer].oderId, type: 'chow', meld: result.meld });
          broadcastState(roomCode, game);
          setTimeout(() => processAITurn(roomCode), 1500);
          return;
        }
      }
    }

    // No claims, next turn
    const nextResult = game.nextTurn();
    if (nextResult.drawn) {
      io.to(roomCode).emit('gameDraw', { reason: 'Wall exhausted' });
      game.phase = 'ended';
    } else {
      broadcastState(roomCode, game);
      if (nextResult.isAI) {
        setTimeout(() => processAITurn(roomCode), 1500);
      }
    }
  }

  function broadcastState(roomCode, game) {
    for (const pid of game.playerOrder) {
      if (!game.aiPlayers.has(pid)) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
    }
  }

  socket.on('discard', (tileId, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game || game.phase !== 'playing') return callback({ success: false, error: 'Game not in progress' });

    const result = game.discard(socket.id, tileId);
    if (result.success) {
      io.to(currentRoom).emit('tileDiscarded', { oderId: currentUser.id, tile: result.tile });
      broadcastState(currentRoom, game);
      callback({ success: true });

      // Wait for claims, then process AI or next turn
      setTimeout(() => processAfterDiscard(currentRoom), 3000);
    } else {
      callback(result);
    }
  });

  socket.on('claimPung', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimPung(socket.id);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', { oderId: currentUser.id, type: 'pung', meld: result.meld });
      broadcastState(currentRoom, game);
    }
    callback(result);
  });

  socket.on('claimKong', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimKong(socket.id);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', { oderId: currentUser.id, type: 'kong', meld: result.meld });
      broadcastState(currentRoom, game);
    }
    callback(result);
  });

  socket.on('claimChow', (tileIds, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimChow(socket.id, tileIds);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', { oderId: currentUser.id, type: 'chow', meld: result.meld });
      broadcastState(currentRoom, game);
    }
    callback(result);
  });

  socket.on('mahjong', (fromDiscard, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.declareMahjong(socket.id, fromDiscard);
    if (result.success) {
      if (game.gameId) {
        db.endGame(game.gameId, currentUser.id);
        for (const pid of game.playerOrder) {
          const p = game.players[pid];
          const isWinner = pid === socket.id;
          db.updatePlayerStats(p.oderId, isWinner, isWinner ? result.score : 0, isWinner);
        }
      }
      io.to(currentRoom).emit('gameWon', {
        winnerId: currentUser.id,
        winnerName: currentUser.displayName,
        score: result.score,
        hand: result.hand,
        exposed: result.exposed
      });
      callback({ success: true, score: result.score });
      console.log(`🎉 ${currentUser.displayName} won in ${currentRoom}!`);
    } else {
      callback(result);
    }
  });

  socket.on('chat', async (message) => {
    if (currentRoom && currentUser) {
      // Rate limit chat
      if (rateLimit(`chat:${socket.id}`, 20, 60000)) return; // 20 per minute
      
      const msg = sanitize(message, 200);
      if (!msg.trim()) return;
      
      // Emit human message
      io.to(currentRoom).emit('chat', {
        displayName: sanitize(currentUser.displayName, 30),
        message: msg,
        timestamp: Date.now()
      });

      // Store chat history
      if (!roomChatHistory.has(currentRoom)) {
        roomChatHistory.set(currentRoom, []);
      }
      const history = roomChatHistory.get(currentRoom);
      history.push({ name: currentUser.displayName, text: msg });
      if (history.length > 20) history.shift(); // Keep last 20

      // Try AI response
      const game = games.get(currentRoom);
      if (game && game.aiPlayers.size > 0) {
        const aiReply = await getAIResponse(currentRoom, history, game);
        if (aiReply) {
          history.push(aiReply);
          io.to(currentRoom).emit('chat', {
            displayName: aiReply.name,
            message: aiReply.text,
            timestamp: Date.now(),
            isAI: true
          });
        }
      }
    }
  });

  socket.on('leaveRoom', () => handleLeave());

  socket.on('disconnect', () => {
    handleLeave();
    if (currentUser) {
      db.setUserOnline(currentUser.id, false);
      playerSockets.delete(currentUser.id);
      io.emit('playerOffline', { id: currentUser.id });
    }
    socketUsers.delete(socket.id);
    console.log(`🔌 Disconnected: ${socket.id}`);
  });

  function handleLeave() {
    if (currentRoom) {
      const game = games.get(currentRoom);
      if (game) {
        game.removePlayer(socket.id);
        if (game.playerOrder.length === 0) {
          games.delete(currentRoom);
          io.emit('lobbyRemoved', { roomCode: currentRoom });
          console.log(`🗑️ Room ${currentRoom} deleted (empty)`);
        } else {
          socket.to(currentRoom).emit('playerLeft', { displayName: currentUser?.displayName, players: game.getPlayersInfo() });
          io.emit('lobbyUpdated', { roomCode: currentRoom, playerCount: game.playerOrder.length, players: game.getPlayersInfo() });
        }
      }
      socket.leave(currentRoom);
      currentRoom = null;
    }
  }
});

// Initialize and start
async function initAndStart() {
  await db.init();
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🀄 Mahjong server running on port ${PORT}`);
  });
}

initAndStart();
