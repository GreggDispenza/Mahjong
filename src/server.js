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
const JWT_SECRET = process.env.JWT_SECRET || 'mahjong-secret-' + Date.now();

// Initialize
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const db = new MahjongDB();
const games = new Map();
const playerSockets = new Map(); // userId -> socketId
const socketUsers = new Map();   // socketId -> user

// Initialize database before starting
async function initAndStart() {
  await db.init();
  
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🀄  MAHJONG ONLINE                                      ║
║                                                           ║
║   Server running on port ${PORT}                            ║
║   http://localhost:${PORT}                                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

initAndStart();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
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

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://greggdispenza.github.io");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ==================== REST API ====================

// Register
app.post('/api/register', async (req, res) => {
  const { username, password, displayName, email } = req.body;

  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const result = await db.createUser(username, password, displayName, email);

  if (result.success) {
    const token = jwt.sign({ id: result.userId, username, displayName }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: result.userId, username, displayName } });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

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

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// Get current user
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  const stats = db.getPlayerStats(req.user.id);
  res.json({ user, stats });
});

// Update profile
app.put('/api/profile', authMiddleware, (req, res) => {
  const result = db.updateProfile(req.user.id, req.body);
  res.json(result);
});

// Get player stats
app.get('/api/stats/:userId', (req, res) => {
  const stats = db.getPlayerStats(parseInt(req.params.userId));
  if (stats) {
    res.json(stats);
  } else {
    res.status(404).json({ error: 'Stats not found' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  const sortBy = req.query.sort || 'total_score';
  const leaderboard = db.getLeaderboard(50, sortBy);
  res.json(leaderboard);
});

// Get player history
app.get('/api/history/:userId', (req, res) => {
  const history = db.getPlayerHistory(parseInt(req.params.userId), 50);
  res.json(history);
});

// Get online players
app.get('/api/online', (req, res) => {
  const players = db.getOnlinePlayers();
  res.json(players);
});

// Get active games/lobbies
app.get('/api/lobbies', (req, res) => {
  const lobbies = [];
  for (const [code, game] of games) {
    if (game.phase === 'waiting') {
      lobbies.push({
        roomCode: code,
        playerCount: game.playerOrder.length,
        players: game.getPlayersInfo(),
        createdAt: game.createdAt
      });
    }
  }
  res.json(lobbies);
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);
  let currentUser = null;
  let currentRoom = null;

  // Authenticate
  socket.on('auth', (token, callback) => {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      currentUser = user;
      socketUsers.set(socket.id, user);
      playerSockets.set(user.id, socket.id);
      db.setUserOnline(user.id, true);

      // Broadcast online status
      io.emit('playerOnline', { id: user.id, displayName: user.displayName });

      callback({ success: true, user });
      console.log(`✅ Authenticated: ${user.displayName}`);
    } catch (err) {
      callback({ success: false, error: 'Invalid token' });
    }
  });

  // Create room
  socket.on('createRoom', (callback) => {
    if (!currentUser) return callback({ success: false, error: 'Not authenticated' });

    let roomCode;
    do { roomCode = generateRoomCode(); } while (games.has(roomCode));

    const game = new MahjongGame(roomCode);
    const result = game.addPlayer(socket.id, currentUser.id, currentUser.displayName, currentUser.avatar);

    if (result.success) {
      games.set(roomCode, game);
      socket.join(roomCode);
      currentRoom = roomCode;

      callback({
        success: true,
        roomCode,
        seatWind: result.seatWind,
        players: game.getPlayersInfo()
      });

      // Broadcast new lobby
      io.emit('lobbyCreated', {
        roomCode,
        playerCount: 1,
        players: game.getPlayersInfo()
      });

      console.log(`🎮 Room ${roomCode} created by ${currentUser.displayName}`);
    } else {
      callback(result);
    }
  });

  // Join room
  socket.on('joinRoom', (roomCode, callback) => {
    if (!currentUser) return callback({ success: false, error: 'Not authenticated' });

    roomCode = roomCode.toUpperCase();
    const game = games.get(roomCode);

    if (!game) return callback({ success: false, error: 'Room not found' });
    if (game.phase !== 'waiting') return callback({ success: false, error: 'Game in progress' });

    const result = game.addPlayer(socket.id, currentUser.id, currentUser.displayName, currentUser.avatar);

    if (result.success) {
      socket.join(roomCode);
      currentRoom = roomCode;

      socket.to(roomCode).emit('playerJoined', {
        oderId: currentUser.id,
        displayName: currentUser.displayName,
        seatWind: result.seatWind,
        playerCount: result.playerCount
      });

      callback({
        success: true,
        roomCode,
        seatWind: result.seatWind,
        players: game.getPlayersInfo()
      });

      // Update lobby
      io.emit('lobbyUpdated', {
        roomCode,
        playerCount: result.playerCount,
        players: game.getPlayersInfo()
      });

      if (game.canStart()) {
        io.to(roomCode).emit('readyToStart', { players: game.getPlayersInfo() });
      }

      console.log(`👤 ${currentUser.displayName} joined ${roomCode}`);
    } else {
      callback(result);
    }
  });

  // Start game
  socket.on('startGame', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });

    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.startGame();

    if (result.success) {
      game.gameId = db.createGame(currentRoom);

      // Send state to each player
      for (const pid of game.playerOrder) {
        io.to(pid).emit('gameStarted', game.getStateForPlayer(pid));
      }

      // Remove from lobbies
      io.emit('lobbyRemoved', { roomCode: currentRoom });

      callback({ success: true });
      console.log(`🎲 Game started in ${currentRoom}`);
    } else {
      callback(result);
    }
  });

  // Discard tile
  socket.on('discard', (tileId, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });

    const game = games.get(currentRoom);
    if (!game || game.phase !== 'playing') return callback({ success: false, error: 'Game not in progress' });

    const result = game.discard(socket.id, tileId);

    if (result.success) {
      io.to(currentRoom).emit('tileDiscarded', {
        oderId: currentUser.id,
        tile: result.tile
      });

      // Send updated state to all
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }

      callback({ success: true });

      // Auto-advance after timeout if no claims
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

  // Claim pung
  socket.on('claimPung', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimPung(socket.id);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', {
        oderId: currentUser.id,
        type: 'pung',
        meld: result.meld
      });
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
    }
    callback(result);
  });

  // Claim kong
  socket.on('claimKong', (callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimKong(socket.id);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', {
        oderId: currentUser.id,
        type: 'kong',
        meld: result.meld
      });
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
    }
    callback(result);
  });

  // Claim chow
  socket.on('claimChow', (tileIds, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.claimChow(socket.id, tileIds);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', {
        oderId: currentUser.id,
        type: 'chow',
        meld: result.meld
      });
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
    }
    callback(result);
  });

  // Concealed kong
  socket.on('concealedKong', (tileId, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.declareConcealedKong(socket.id, tileId);
    if (result.success) {
      io.to(currentRoom).emit('meldClaimed', {
        oderId: currentUser.id,
        type: 'kong',
        meld: result.meld,
        concealed: true
      });
      for (const pid of game.playerOrder) {
        io.to(pid).emit('stateUpdate', game.getStateForPlayer(pid));
      }
    }
    callback(result);
  });

  // Declare Mahjong
  socket.on('mahjong', (fromDiscard, callback) => {
    if (!currentRoom) return callback({ success: false, error: 'Not in a room' });
    const game = games.get(currentRoom);
    if (!game) return callback({ success: false, error: 'Game not found' });

    const result = game.declareMahjong(socket.id, fromDiscard);

    if (result.success) {
      // Update database
      if (game.gameId) {
        db.endGame(game.gameId, currentUser.id);
        for (const pid of game.playerOrder) {
          const p = game.players[pid];
          const isWinner = pid === socket.id;
          db.updatePlayerStats(p.oderId, isWinner, isWinner ? result.score : 0, isWinner);
          db.addGameParticipant(game.gameId, p.oderId, p.seatWind, isWinner ? result.score : 0, isWinner);
        }
      }

      io.to(currentRoom).emit('gameWon', {
        winnerId: currentUser.id,
        winnerName: currentUser.displayName,
        score: result.score,
        hand: result.hand,
        exposed: result.exposed,
        flowers: result.flowers
      });

      callback({ success: true, score: result.score });
      console.log(`🎉 ${currentUser.displayName} won in ${currentRoom}!`);
    } else {
      callback(result);
    }
  });

  // Chat
  socket.on('chat', (message) => {
    if (currentRoom && currentUser) {
      io.to(currentRoom).emit('chat', {
        oderId: currentUser.id,
        displayName: currentUser.displayName,
        message: message.substring(0, 200),
        timestamp: Date.now()
      });
    }
  });

  // Leave room
  socket.on('leaveRoom', () => {
    handleLeave();
  });

  // Disconnect
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
        } else {
          socket.to(currentRoom).emit('playerLeft', {
            oderId: currentUser?.id,
            displayName: currentUser?.displayName
          });
          io.emit('lobbyUpdated', {
            roomCode: currentRoom,
            playerCount: game.playerOrder.length,
            players: game.getPlayersInfo()
          });
        }
      }
      socket.leave(currentRoom);
      currentRoom = null;
    }
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  db.close();
  process.exit(0);
});
