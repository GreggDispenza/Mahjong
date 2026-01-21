/**
 * ═══════════════════════════════════════════════════════════════════════
 * HKOS MAHJONG SERVER - 100% Specification Compliant
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Multiplayer server with Socket.IO
 * Integrates with HKOSEngine for game logic
 * Supports AI players, Furiten system, and proper wall management
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const jwt = require('jsonwebtoken');

// Import game logic and database
const MahjongGame = require('./game');
const db = require('./database');

// Configuration
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Warning for production
if (JWT_SECRET === 'your-secret-key-change-in-production') {
    console.warn('⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET environment variable in production!');
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../docs')));

// Game rooms storage
const rooms = new Map();
const userSockets = new Map();

// AI player counter
let aiPlayerCounter = 0;

// ═══════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sanitize user input to prevent XSS
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .trim()
        .slice(0, 100); // Limit length
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Generate AI player
 */
function createAIPlayer() {
    aiPlayerCounter++;
    return {
        id: `AI-${aiPlayerCounter}`,
        name: `AI Player ${aiPlayerCounter}`,
        isAI: true,
        socketId: null
    };
}

/**
 * Get game state for specific player
 * NEW: Includes Furiten indicators and wall counts
 */
function getGameState(game, playerId) {
    if (!game) return null;

    const player = game.players.find(p => p.id === playerId);
    const playerIndex = game.players.findIndex(p => p.id === playerId);

    return {
        gameId: game.gameId,
        state: game.state,
        currentPlayer: game.currentPlayer,
        prevailingWind: game.prevailingWind,
        dealerPosition: game.dealerPosition,
        turnCount: game.turnCount,
        
        // NEW: Wall information
        liveWallCount: game.wallState ? (game.liveWall.length - game.wallState.livePointer) : 120,
        deadWallCount: game.wallState ? (game.deadWall.length - game.wallState.deadPointer) : 16,
        
        // Player information
        players: game.players.map((p, index) => ({
            id: p.id,
            name: sanitizeInput(p.name),
            isAI: p.isAI,
            wind: p.wind,
            position: p.position,
            concealedCount: p.concealed.length,
            concealed: p.id === playerId ? p.concealed : [], // Only show own hand
            exposed: p.exposed,
            discards: p.discards,
            score: p.score,
            
            // NEW: Furiten indicator (visible to all players)
            isFuriten: p.isFuriten || false,
            
            // Is this the current viewer?
            isYou: index === playerIndex
        })),
        
        // Claim information
        lastDiscard: game.lastDiscard,
        pendingClaims: game.pendingClaims ? game.pendingClaims.length : 0,
        canClaim: game.state === 'CLAIMING' && game.pendingClaims?.some(c => c.player.id === playerId)
    };
}

/**
 * Get list of all lobbies (waiting rooms + games in progress)
 */
function getLobbies() {
    const waiting = [];
    const playing = [];
    
    for (const [roomId, room] of rooms.entries()) {
        const roomInfo = {
            roomId,
            playerCount: room.players.length,
            players: room.players.map(p => ({
                name: sanitizeInput(p.name),
                isAI: p.isAI
            })),
            state: room.game ? room.game.state : 'WAITING'
        };
        
        if (room.game && room.game.state === 'PLAYING') {
            // Game in progress
            playing.push({
                ...roomInfo,
                currentTurn: room.game.currentPlayer,
                turnCount: room.game.turnCount,
                discardCount: room.game.players.reduce((sum, p) => sum + p.discards.length, 0)
            });
        } else {
            // Waiting room
            waiting.push(roomInfo);
        }
    }
    
    return { waiting, playing };
}

/**
 * Schedule AI turns automatically
 */
function scheduleAITurns(room) {
    if (!room || !room.game) return;
    if (room.game.state !== 'PLAYING') return;
    
    const currentPlayer = room.game.players[room.game.currentPlayer];
    
    if (currentPlayer && currentPlayer.isAI) {
        // AI player's turn - execute after short delay
        setTimeout(() => {
            if (!room || !room.game) return;
            if (room.game.state !== 'PLAYING') return;
            
            const aiMove = room.game.getAIMove(currentPlayer);
            
            if (aiMove && aiMove.action === 'DISCARD') {
                const result = room.game.discardTile(currentPlayer.id, aiMove.tileIndex);
                
                if (result.success) {
                    // Broadcast game state
                    io.to(room.roomId).emit('gameState', getGameState(room.game, currentPlayer.id));
                    
                    // Check if game ended
                    if (room.game.state === 'ENDED') {
                        handleGameEnd(room);
                    } else {
                        // Continue AI turns if needed
                        scheduleAITurns(room);
                    }
                }
            }
        }, 1000); // 1 second delay for AI thinking
    }
}

/**
 * Handle game end
 */
function handleGameEnd(room) {
    if (!room || !room.game) return;
    
    const game = room.game;
    
    if (game.endReason === 'WIN') {
        const data = game.endData;
        
        io.to(room.roomId).emit('gameWon', {
            winner: sanitizeInput(data.winner.name),
            winnerId: data.winner.id,
            faan: data.faan,
            points: data.points,
            breakdown: data.breakdown, // NEW: Score breakdown
            isSelfDraw: data.isSelfDraw || false,
            loser: data.loser ? sanitizeInput(data.loser.name) : null
        });
        
        // Update database stats
        if (!data.winner.isAI) {
            db.updatePlayerStats(data.winner.id, {
                gamesWon: 1,
                totalScore: data.points
            }).catch(err => console.error('Failed to update stats:', err));
        }
    } else if (game.endReason === 'EXHAUSTIVE_DRAW') {
        io.to(room.roomId).emit('gameDraw', {
            reason: 'Wall exhausted',
            turnCount: game.turnCount
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION HANDLING
// ═══════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // ─── AUTHENTICATION ───
    
    socket.on('authenticate', (data) => {
        const { token } = data;
        const decoded = verifyToken(token);
        
        if (decoded) {
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            userSockets.set(socket.userId, socket.id);
            
            socket.emit('authenticated', {
                success: true,
                userId: decoded.userId,
                username: decoded.username
            });
            
            // Send current lobbies
            socket.emit('lobbies', getLobbies());
        } else {
            socket.emit('authenticated', { success: false, error: 'Invalid token' });
        }
    });
    
    // ─── LOBBY MANAGEMENT ───
    
    socket.on('getLobbies', () => {
        socket.emit('lobbies', getLobbies());
    });
    
    socket.on('createRoom', (data) => {
        if (!socket.userId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const room = {
            roomId,
            host: socket.userId,
            players: [
                {
                    id: socket.userId,
                    name: sanitizeInput(socket.username || 'Player'),
                    isAI: false,
                    socketId: socket.id
                }
            ],
            game: null,
            createdAt: Date.now()
        };
        
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.roomId = roomId;
        
        socket.emit('roomCreated', { roomId, players: room.players });
        
        // Broadcast updated lobbies
        io.emit('lobbies', getLobbies());
    });
    
    socket.on('joinRoom', (data) => {
        if (!socket.userId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }
        
        const { roomId } = data;
        const room = rooms.get(roomId);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.game && room.game.state !== 'WAITING') {
            socket.emit('error', { message: 'Game already in progress' });
            return;
        }
        
        if (room.players.length >= 4) {
            socket.emit('error', { message: 'Room is full' });
            return;
        }
        
        // Add player to room
        room.players.push({
            id: socket.userId,
            name: sanitizeInput(socket.username || 'Player'),
            isAI: false,
            socketId: socket.id
        });
        
        socket.join(roomId);
        socket.roomId = roomId;
        
        // Notify all players in room
        io.to(roomId).emit('playerJoined', {
            players: room.players,
            playerCount: room.players.length
        });
        
        // Broadcast updated lobbies
        io.emit('lobbies', getLobbies());
    });
    
    socket.on('addAI', () => {
        if (!socket.roomId) {
            socket.emit('error', { message: 'Not in a room' });
            return;
        }
        
        const room = rooms.get(socket.roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.players.length >= 4) {
            socket.emit('error', { message: 'Room is full' });
            return;
        }
        
        // Add AI player
        const aiPlayer = createAIPlayer();
        room.players.push(aiPlayer);
        
        io.to(socket.roomId).emit('playerJoined', {
            players: room.players,
            playerCount: room.players.length
        });
        
        io.emit('lobbies', getLobbies());
    });
    
    // ─── GAME START ───
    
    socket.on('startGame', () => {
        if (!socket.roomId) {
            socket.emit('error', { message: 'Not in a room' });
            return;
        }
        
        const room = rooms.get(socket.roomId);
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }
        
        if (room.host !== socket.userId) {
            socket.emit('error', { message: 'Only host can start game' });
            return;
        }
        
        // Auto-fill with AI players if needed
        while (room.players.length < 4) {
            const aiPlayer = createAIPlayer();
            room.players.push(aiPlayer);
        }
        
        // Create new game
        try {
            room.game = new MahjongGame(room.roomId, room.players);
            const result = room.game.startGame();
            
            if (result.success) {
                // Emit game state to all players
                for (const player of room.players) {
                    if (player.isAI) continue;
                    
                    const socketId = userSockets.get(player.id);
                    if (socketId) {
                        io.to(socketId).emit('gameStarted', getGameState(room.game, player.id));
                    }
                }
                
                // Broadcast updated lobbies
                io.emit('lobbies', getLobbies());
                
                // Start AI turns if dealer is AI
                scheduleAITurns(room);
            } else {
                socket.emit('error', { message: 'Failed to start game' });
            }
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('error', { message: 'Failed to start game: ' + error.message });
        }
    });
    
    // ─── GAME ACTIONS ───
    
    socket.on('discardTile', (data) => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || !room.game) return;
        
        const { tileIndex } = data;
        const result = room.game.discardTile(socket.userId, tileIndex);
        
        if (result.success) {
            // Broadcast updated game state to all players
            for (const player of room.game.players) {
                if (player.isAI) continue;
                
                const socketId = userSockets.get(player.id);
                if (socketId) {
                    io.to(socketId).emit('gameState', getGameState(room.game, player.id));
                }
            }
            
            // Check if game ended
            if (room.game.state === 'ENDED') {
                handleGameEnd(room);
            } else {
                // NEW: Continue AI turns after human discard
                scheduleAITurns(room);
            }
        } else {
            socket.emit('error', { message: result.reason || 'Invalid move' });
        }
    });
    
    socket.on('claimTile', (data) => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || !room.game) return;
        
        const { claimType } = data; // 'WIN', 'PUNG', 'KONG', 'CHOW'
        
        // Find player's pending claim
        const playerClaim = room.game.pendingClaims?.find(c => c.player.id === socket.userId);
        
        if (!playerClaim) {
            socket.emit('error', { message: 'No valid claim available' });
            return;
        }
        
        if (playerClaim.type !== claimType) {
            socket.emit('error', { message: 'Invalid claim type' });
            return;
        }
        
        // Execute claim
        const winningClaim = room.game.resolveClaims();
        
        if (winningClaim && winningClaim.player.id === socket.userId) {
            // Broadcast updated state
            for (const player of room.game.players) {
                if (player.isAI) continue;
                
                const socketId = userSockets.get(player.id);
                if (socketId) {
                    io.to(socketId).emit('gameState', getGameState(room.game, player.id));
                }
            }
            
            // Check if game ended
            if (room.game.state === 'ENDED') {
                handleGameEnd(room);
            }
        }
    });
    
    socket.on('skipClaim', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || !room.game) return;
        
        // NEW: Handle Furiten when player skips a winning tile
        room.game.skipClaim(socket.userId);
        
        // Broadcast updated state
        for (const player of room.game.players) {
            if (player.isAI) continue;
            
            const socketId = userSockets.get(player.id);
            if (socketId) {
                io.to(socketId).emit('gameState', getGameState(room.game, player.id));
            }
        }
        
        // Check if all claims resolved
        if (room.game.state === 'PLAYING') {
            // NEW: Continue AI turns after skip
            scheduleAITurns(room);
        }
    });
    
    socket.on('declareKong', (data) => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || !room.game) return;
        
        const { tiles } = data;
        const result = room.game.declareKong(socket.userId, tiles);
        
        if (result.success) {
            // Broadcast updated state
            for (const player of room.game.players) {
                if (player.isAI) continue;
                
                const socketId = userSockets.get(player.id);
                if (socketId) {
                    io.to(socketId).emit('gameState', getGameState(room.game, player.id));
                }
            }
            
            // Check if can win on kong replacement
            if (result.canWin) {
                socket.emit('canWinOnKong', {
                    faan: result.scoreResult.totalFaan,
                    points: result.scoreResult.points,
                    breakdown: result.scoreResult.breakdown
                });
            }
            
            // Check if game ended (dead wall exhausted)
            if (room.game.state === 'ENDED') {
                handleGameEnd(room);
            }
        } else {
            socket.emit('error', { message: result.reason || 'Invalid kong' });
        }
    });
    
    // ─── CHAT ───
    
    socket.on('chatMessage', (data) => {
        if (!socket.roomId) return;
        
        const message = sanitizeInput(data.message);
        if (!message) return;
        
        io.to(socket.roomId).emit('chatMessage', {
            userId: socket.userId,
            username: sanitizeInput(socket.username || 'Player'),
            message,
            timestamp: Date.now()
        });
    });
    
    // ─── DISCONNECT HANDLING ───
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.userId) {
            userSockets.delete(socket.userId);
        }
        
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            
            if (room) {
                // Remove player or replace with AI
                const playerIndex = room.players.findIndex(p => p.id === socket.userId);
                
                if (playerIndex !== -1) {
                    if (room.game && room.game.state === 'PLAYING') {
                        // Replace with AI during active game
                        const aiPlayer = createAIPlayer();
                        aiPlayer.concealed = room.players[playerIndex].concealed;
                        aiPlayer.exposed = room.players[playerIndex].exposed;
                        aiPlayer.discards = room.players[playerIndex].discards;
                        aiPlayer.score = room.players[playerIndex].score;
                        aiPlayer.wind = room.players[playerIndex].wind;
                        aiPlayer.position = room.players[playerIndex].position;
                        
                        // NEW: Preserve Furiten state
                        aiPlayer.isFuriten = room.players[playerIndex].isFuriten;
                        aiPlayer.furitenState = room.players[playerIndex].furitenState;
                        
                        room.players[playerIndex] = aiPlayer;
                        room.game.players[playerIndex] = aiPlayer;
                        
                        io.to(socket.roomId).emit('playerReplaced', {
                            position: playerIndex,
                            newPlayer: {
                                name: aiPlayer.name,
                                isAI: true
                            }
                        });
                        
                        // Continue game with AI
                        scheduleAITurns(room);
                    } else {
                        // Remove player if game hasn't started
                        room.players.splice(playerIndex, 1);
                        
                        io.to(socket.roomId).emit('playerLeft', {
                            players: room.players,
                            playerCount: room.players.length
                        });
                        
                        // Delete empty rooms
                        if (room.players.length === 0) {
                            rooms.delete(socket.roomId);
                        }
                    }
                    
                    // Broadcast updated lobbies
                    io.emit('lobbies', getLobbies());
                }
            }
        }
    });
    
    socket.on('logout', () => {
        // Handle logout same as disconnect
        socket.disconnect();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// HTTP ROUTES
// ═══════════════════════════════════════════════════════════════════════

// Serve main HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        rooms: rooms.size,
        connectedUsers: userSockets.size,
        timestamp: Date.now()
    });
});

// API: Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, name, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const result = await db.createUser(sanitizeInput(username), sanitizeInput(name), password);
        
        if (result.success) {
            const token = jwt.sign(
                { userId: result.userId, username: result.username, name: result.name },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            res.json({
                success: true,
                token,
                userId: result.userId,
                username: result.username,
                name: result.name
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// API: Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const result = await db.verifyUser(sanitizeInput(username), password);
        
        if (result.success) {
            const token = jwt.sign(
                { userId: result.userId, username: result.username },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            res.json({
                success: true,
                token,
                userId: result.userId,
                username: result.username
            });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard(10);
        res.json({
            success: true,
            leaderboard: leaderboard.map(entry => ({
                username: sanitizeInput(entry.username),
                gamesWon: entry.games_won,
                totalScore: entry.total_score
            }))
        });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════

http.listen(PORT, () => {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  HKOS MAHJONG SERVER');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Status: Running`);
    console.log(`  Port: ${PORT}`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`  Specification: HKOS 100% Compliant`);
    console.log(`  Features: Furiten, Wall Management, All 8 Patterns`);
    console.log('═══════════════════════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    http.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = app;
