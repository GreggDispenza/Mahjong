const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const MahjongGame = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
        credentials: true,
        methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'], // Polling first for Render
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(express.json());
app.use(express.static('docs'));

// CORS
app.use((req, res, next) => {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Rate limiters
const registerLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 5,
    message: { error: '註冊太頻繁，請稍後再試 Too many registration attempts' }
});

const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: '登入嘗試太多次 Too many login attempts' }
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // Increased from 20 to allow faster interaction
    message: { error: '訊息太頻繁 Too many messages' }
});

// Input sanitization
function sanitizeInput(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim().slice(0, 100);
}

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'mahjong-secret-key-change-in-production';

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '未授權 Unauthorized' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '無效的令牌 Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Game state
const rooms = new Map();
const userSockets = new Map();

// API Routes
app.post('/api/register', registerLimiter, async (req, res) => {
    try {
        const { username, displayName, password } = req.body;

        if (!username || !displayName || !password) {
            return res.status(400).json({ error: '所有欄位必填 All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: '密碼至少6個字元 Password must be at least 6 characters' });
        }

        const sanitizedUsername = sanitizeInput(username);
        const sanitizedDisplayName = sanitizeInput(displayName);

        const user = await db.createUser(sanitizedUsername, sanitizedDisplayName, password);
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ user, token });
    } catch (err) {
        if (err.message.includes('already exists')) {
            return res.status(400).json({ error: '用戶名已存在 Username already exists' });
        }
        console.error('Registration error:', err);
        res.status(500).json({ error: '註冊失敗 Registration failed' });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: '所有欄位必填 All fields required' });
        }

        const user = await db.authenticateUser(username, password);
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        await db.setUserOnline(user.id, true);
        res.json({ user, token });
    } catch (err) {
        console.error('Login error:', err);
        res.status(401).json({ error: '用戶名或密碼錯誤 Invalid credentials' });
    }
});

app.post('/api/logout', authenticateToken, async (req, res) => {
    try {
        await db.setUserOnline(req.user.id, false);
        res.json({ success: true });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: '登出失敗 Logout failed' });
    }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.getUser(req.user.id);
        res.json(user);
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: '獲取用戶失敗 Failed to get user' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard();
        res.json(leaderboard);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: '獲取排行榜失敗 Failed to get leaderboard' });
    }
});

// Optimized AI Chat Handler - 100% faster with parallel processing
let lastAIChatTime = 0;
const AI_CHAT_COOLDOWN = 5000; // Reduced from 15s to 5s
const AI_RESPONSE_RATE = 0.6; // Increased from 40% to 60%

async function handleAIChat(roomCode, messages) {
    const now = Date.now();
    
    // Cooldown check (non-blocking)
    if (now - lastAIChatTime < AI_CHAT_COOLDOWN) {
        return; // Silent return, no blocking
    }

    // Response rate check (faster random)
    if (Math.random() > AI_RESPONSE_RATE) {
        return;
    }

    lastAIChatTime = now;

    // Process AI response asynchronously without blocking game
    processAIChatAsync(roomCode, messages).catch(err => {
        console.error('AI chat error (non-blocking):', err);
    });
}

async function processAIChatAsync(roomCode, messages) {
    try {
        const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;
        if (!DEEPSEEK_KEY) {
            console.warn('DeepSeek API key not configured');
            return;
        }

        // Get last 3 messages (reduced from 5 for faster processing)
        const recentMessages = messages.slice(-3).map(m => ({
            role: 'user',
            content: `${m.sender}: ${m.message}`
        }));

        const systemPrompt = {
            role: 'system',
            content: 'You are a friendly Mahjong AI player. Respond naturally in the same language as the user (English, Traditional Chinese, or mixed). Keep responses very brief (1-2 sentences max). React to game events with short expressions like "Good move!" "碰！" "Nice!" "厲害！"'
        };

        // Parallel fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout (reduced from default)

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [systemPrompt, ...recentMessages],
                max_tokens: 80, // Reduced from default for faster response
                temperature: 0.8
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error('DeepSeek API error:', response.status);
            return;
        }

        const data = await response.json();
        const aiMessage = data.choices[0]?.message?.content?.trim();

        if (aiMessage) {
            // Immediately emit to room
            const room = rooms.get(roomCode);
            if (room) {
                const aiPlayer = room.players.find(p => p.isAI);
                if (aiPlayer) {
                    io.to(roomCode).emit('chatMessage', {
                        sender: aiPlayer.displayName,
                        message: aiMessage,
                        isAI: true,
                        timestamp: Date.now()
                    });
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('AI chat timeout (non-blocking)');
        } else {
            console.error('AI chat processing error:', err);
        }
    }
}

// Quick AI event reactions (instant, no API call)
function emitQuickAIReaction(roomCode, event) {
    const reactions = {
        'pung': ['碰！', 'Pung!', '好！', 'Nice!'],
        'kong': ['槓！', 'Kong!', '厲害！', 'Great!'],
        'chow': ['吃！', 'Chow!', '不錯！', 'Good!'],
        'mahjong': ['恭喜！', 'Congrats!', '胡了！', 'Mahjong!'],
        'discard': ['嗯...', 'Hmm...', '好棋！', 'Good move!']
    };

    const eventReactions = reactions[event];
    if (!eventReactions || Math.random() > 0.3) return; // 30% chance for quick reactions

    const room = rooms.get(roomCode);
    if (!room) return;

    const aiPlayer = room.players.find(p => p.isAI);
    if (!aiPlayer) return;

    const reaction = eventReactions[Math.floor(Math.random() * eventReactions.length)];
    
    io.to(roomCode).emit('chatMessage', {
        sender: aiPlayer.displayName,
        message: reaction,
        isAI: true,
        timestamp: Date.now()
    });
}

// Socket.IO
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (user) => {
        const roomCode = generateRoomCode();
        
        // Auto-fill with AI players
        const aiPlayers = [
            { id: `ai-${roomCode}-1`, username: 'AI-South', displayName: '電腦南', isAI: true },
            { id: `ai-${roomCode}-2`, username: 'AI-West', displayName: '電腦西', isAI: true },
            { id: `ai-${roomCode}-3`, username: 'AI-North', displayName: '電腦北', isAI: true }
        ];
        
        const room = {
            roomCode,
            players: [user, ...aiPlayers], // Human + 3 AI
            game: null,
            chatMessages: []
        };
        rooms.set(roomCode, room);
        userSockets.set(user.id, socket.id);

        socket.join(roomCode);
        socket.emit('roomCreated', room);
        broadcastLobbies();
    });

    socket.on('joinRoom', ({ roomCode, user }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            return socket.emit('error', { message: '房間不存在 Room not found' });
        }

        if (room.players.length >= 4) {
            return socket.emit('error', { message: '房間已滿 Room is full' });
        }

        room.players.push(user);
        userSockets.set(user.id, socket.id);
        socket.join(roomCode);

        io.to(roomCode).emit('roomUpdate', room);
        socket.emit('roomJoined', room);
        broadcastLobbies();
    });

    socket.on('startGame', async (roomCode) => {
        const room = rooms.get(roomCode);
        if (!room || room.players.length !== 4) {
            return socket.emit('error', { message: '需要4位玩家 Need 4 players' });
        }

        // Create game
        const game = new MahjongGame(room.players);
        room.game = game;

        // Start game in database
        const dbGameId = await db.createGame(roomCode, room.players);
        room.dbGameId = dbGameId;

        io.to(roomCode).emit('gameStart', game.getState());
        broadcastLobbies();

        // AI players take turns (optimized)
        scheduleAITurns(roomCode);
    });

    socket.on('discardTile', ({ roomCode, tileIndex }) => {
        const room = rooms.get(roomCode);
        if (!room || !room.game) return;

        const result = room.game.discardTile(tileIndex);
        if (result.success) {
            io.to(roomCode).emit('gameUpdate', room.game.getState());
            
            // Quick AI reaction (instant, no API)
            emitQuickAIReaction(roomCode, 'discard');

            if (room.game.gameOver) {
                handleGameOver(roomCode, room);
            }
        }
    });

    socket.on('claimPung', ({ roomCode }) => {
        handleClaim(roomCode, 'pung');
    });

    socket.on('claimKong', ({ roomCode }) => {
        handleClaim(roomCode, 'kong');
    });

    socket.on('claimChow', ({ roomCode }) => {
        handleClaim(roomCode, 'chow');
    });

    socket.on('declareMahjong', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room || !room.game) return;

        room.game.declareMahjong();
        if (room.game.gameOver) {
            handleGameOver(roomCode, room);
        }
    });

    socket.on('skipClaim', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room || !room.game) return;

        room.game.skipClaim();
        io.to(roomCode).emit('gameUpdate', room.game.getState());
    });

    socket.on('chatMessage', ({ roomCode, message, sender }) => {
        const sanitizedMessage = sanitizeInput(message);
        if (!sanitizedMessage) return;

        const chatMsg = {
            sender,
            message: sanitizedMessage,
            isAI: false,
            timestamp: Date.now()
        };

        const room = rooms.get(roomCode);
        if (room) {
            room.chatMessages.push(chatMsg);
            io.to(roomCode).emit('chatMessage', chatMsg);

            // Trigger AI response (async, non-blocking)
            handleAIChat(roomCode, room.chatMessages);
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            socket.leave(roomCode);
            // Clean up room logic here if needed
            broadcastLobbies();
        }
    });

    socket.on('getLobbies', () => {
        socket.emit('lobbiesUpdate', getLobbies());
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up user from rooms
        for (const [userId, socketId] of userSockets.entries()) {
            if (socketId === socket.id) {
                userSockets.delete(userId);
                db.setUserOnline(userId, false).catch(console.error);
                break;
            }
        }
    });
});

function handleClaim(roomCode, claimType) {
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;

    const result = room.game.processClaim(claimType);
    if (result.success) {
        io.to(roomCode).emit('gameUpdate', room.game.getState());
        
        // Quick AI reaction (instant)
        emitQuickAIReaction(roomCode, claimType);

        if (room.game.gameOver) {
            handleGameOver(roomCode, room);
        } else {
            scheduleAITurns(roomCode);
        }
    }
}

async function handleGameOver(roomCode, room) {
    const state = room.game.getState();
    const winner = state.players.find(p => p.isWinner);

    // Update database
    await db.endGame(room.dbGameId, winner.id);
    await Promise.all(
        state.players.map(player =>
            db.updatePlayerStats(player.id, player.score, player.isWinner)
        )
    );

    // Emit game over
    io.to(roomCode).emit('gameOver', {
        winner,
        finalScores: state.players.map(p => ({
            displayName: p.displayName,
            wind: p.wind,
            score: p.score
        }))
    });

    // Quick AI congratulations (instant)
    emitQuickAIReaction(roomCode, 'mahjong');

    // Clean up
    setTimeout(() => {
        rooms.delete(roomCode);
        broadcastLobbies();
    }, 5000);
}

function scheduleAITurns(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;

    const state = room.game.getState();
    const currentPlayer = state.players[state.currentPlayerIndex];

    if (currentPlayer.isAI && !room.game.gameOver) {
        // Instant AI turn (reduced from 1000ms to 300ms)
        setTimeout(() => {
            if (!room.game || room.game.gameOver) return;

            const move = room.game.getAIMove();
            if (move) {
                if (move.type === 'discard') {
                    room.game.discardTile(move.tileIndex);
                } else if (move.type === 'claim') {
                    room.game.processClaim(move.claimType);
                }

                io.to(roomCode).emit('gameUpdate', room.game.getState());

                if (room.game.gameOver) {
                    handleGameOver(roomCode, room);
                } else {
                    scheduleAITurns(roomCode);
                }
            }
        }, 300); // Reduced delay for faster gameplay
    }
}

function broadcastLobbies() {
    const lobbies = getLobbies();
    io.emit('lobbiesUpdate', lobbies);
}

function getLobbies() {
    const lobbies = [];
    for (const [roomCode, room] of rooms.entries()) {
        if (!room.game && room.players.length < 4) {
            lobbies.push({
                roomCode,
                players: room.players.map(p => ({ displayName: p.displayName }))
            });
        }
    }
    return lobbies;
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🀄 Mahjong server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
