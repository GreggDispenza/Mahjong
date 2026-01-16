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
const JWT_SECRET = process.env.JWT_SECRET || 'mahjong-secret-key-2024';

// Initialize
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const db = new MahjongDB();
const games = new Map();
const playerSockets = new Map();
const socketUsers = new Map();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'docs')));

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (username.length < 3) return res.status(400).json({ error: 'Username must be 3+ characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters' });

  const result = await db.createUser(username, password, displayName);
  if (result.success) {
    const token = jwt.sign({ id: result.userId, username, displayName }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: result.userId, username, displayName } });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const result = await db.authenticateUser(username, password);
  if (result.success) {
    const token = jwt.sign(
      { id: result.user.id, username: result.user.username, displayName: result.user.displayName },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: result.user });
  } else {
    res.status(401).json({ error: result.error });
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

// Debug endpoint
app.get('/api/debug', (req, res) => {
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

    const result = game.startGame();
    if (result.success) {
      game.gameId = db.createGame(currentRoom);
      for (const pid of game.playerOrder) {
        io.to(pid).emit('gameStarted', game.getStateForPlayer(pid));
      }
      io.emit('lobbyRemoved', { roomCode: currentRoom });
      callback({ success: true });
      console.log(`🎲 Game started: ${currentRoom}`);
    } else {
      callback(result);
    }
  });

  socket.on('discard', (tileId, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game || game.phase !== 'playing') return callback({ success: false, error: 'Game not in progress' });

    const result = game.discard(socket.id, tileId);
    if (result.success) {
      io.to(currentRoom).emit('tileDiscarded', { oderId: currentUser.id, tile: result.tile });
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
      callback({ success: true });

      setTimeout(() => {
        if (game.lastDiscard && game.lastDiscard.id === result.tile.id) {
          const nextResult = game.nextTurn();
          if (nextResult.drawn) {
            io.to(currentRoom).emit('gameDraw', { reason: 'Wall exhausted' });
            game.phase = 'ended';
          } else {
            for (const pid of game.playerOrder) {
              io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
            }
          }
        }
      }, 5000);
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
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
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
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
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
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
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

  socket.on('chat', (message) => {
    if (currentRoom && currentUser) {
      io.to(currentRoom).emit('chat', {
        displayName: currentUser.displayName,
        message: message.substring(0, 200),
        timestamp: Date.now()
      });
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
