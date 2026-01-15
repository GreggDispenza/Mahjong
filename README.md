# 🀄 Mahjong Online

A beautiful, real-time multiplayer Mahjong game with persistent accounts, game history, leaderboards, and social features.

![Mahjong Online](https://img.shields.io/badge/Node.js-18+-green) ![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-blue) ![SQLite](https://img.shields.io/badge/SQLite-3-orange)

## ✨ Features

- **Real-time 4-Player Multiplayer** - Play with friends or strangers instantly
- **Persistent Accounts** - Sign up, login, track your progress
- **Game History** - Review all your past games
- **Leaderboards** - Compete globally with multiple ranking categories
- **Beautiful UI** - Modern Asian-inspired dark theme
- **Responsive Design** - Works on desktop and mobile
- **Real-time Chat** - Communicate with players during games
- **Hong Kong Rules** - Classic Mahjong gameplay

## 🚀 Quick Start

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/mahjong-online.git
cd mahjong-online

# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `JWT_SECRET` | auto-generated | Secret for JWT tokens |

## 🌐 Deployment Options

### Option 1: Railway (Recommended - Free Tier)

1. Fork this repository
2. Go to [Railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your forked repository
5. Railway auto-detects Node.js and deploys!

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

### Option 2: Render (Free Tier)

1. Go to [Render.com](https://render.com)
2. New → Web Service
3. Connect your GitHub repository
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Deploy!

### Option 3: Fly.io (Free Tier)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from project directory)
fly launch

# Deploy
fly deploy
```

### Option 4: Heroku

```bash
# Install Heroku CLI
# Create app
heroku create mahjong-online

# Deploy
git push heroku main
```

### Option 5: DigitalOcean App Platform

1. Go to DigitalOcean App Platform
2. Create App → GitHub
3. Select repository
4. Auto-detected as Node.js
5. Deploy!

### Option 6: VPS (Ubuntu/Debian)

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/yourusername/mahjong-online.git
cd mahjong-online
npm install

# Install PM2 for process management
sudo npm install -g pm2

# Start with PM2
pm2 start src/server.js --name mahjong

# Auto-start on reboot
pm2 startup
pm2 save

# Setup Nginx reverse proxy (optional)
sudo apt install nginx
```

Nginx config (`/etc/nginx/sites-available/mahjong`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📁 Project Structure

```
mahjong-online/
├── src/
│   ├── server.js      # Express + Socket.IO server
│   ├── database.js    # SQLite database layer
│   └── game.js        # Mahjong game engine
├── public/
│   ├── index.html     # Single-page application
│   ├── css/
│   │   └── style.css  # Beautiful dark theme
│   └── js/
│       └── app.js     # Client-side application
├── data/
│   └── mahjong.db     # SQLite database (auto-created)
└── package.json
```

## 🎮 How to Play

### Objective
Form a winning hand of **4 melds + 1 pair** (14 tiles).

### Melds
- **Chow (吃)**: 3 consecutive suited tiles (e.g., 1-2-3 Bamboo)
- **Pung (碰)**: 3 identical tiles
- **Kong (杠)**: 4 identical tiles

### Gameplay Flow
1. **Draw** a tile from the wall
2. **Organize** your hand
3. **Discard** one tile
4. **Claim** opponents' discards (Pung/Kong from anyone, Chow from left)
5. **Declare Mahjong** when you have a winning hand!

### Controls
- **Click tile**: Select it
- **Click selected tile**: Discard it
- **Action buttons**: Claim discards or declare Mahjong

## 🔧 API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Login |
| POST | `/api/logout` | Logout |
| GET | `/api/me` | Current user + stats |
| GET | `/api/leaderboard` | Top players |
| GET | `/api/history/:userId` | Game history |
| GET | `/api/lobbies` | Open game rooms |

### Socket.IO Events

**Client → Server:**
- `auth` - Authenticate with JWT
- `createRoom` - Create new game room
- `joinRoom` - Join existing room
- `startGame` - Start the game
- `discard` - Discard a tile
- `claimPung/Kong/Chow` - Claim discards
- `mahjong` - Declare winning hand
- `chat` - Send chat message

**Server → Client:**
- `gameStarted` - Game state
- `stateUpdate` - Updated game state
- `tileDiscarded` - Tile was discarded
- `meldClaimed` - Meld was claimed
- `gameWon` - Game ended with winner
- `chat` - Chat message received

## 🗄️ Database Schema

Uses SQLite with the following tables:
- `users` - User accounts
- `player_stats` - Win/loss statistics
- `games` - Game history
- `game_participants` - Players in each game
- `friends` - Friend relationships

## 🔒 Security

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens for authentication (30-day expiry)
- HTTP-only cookies
- Server-authoritative game state
- Input validation on all endpoints

## 🎨 Customization

### Themes
Edit `public/css/style.css` CSS variables:
```css
:root {
  --bg-dark: #0a0f0d;
  --accent-gold: #d4a853;
  --accent-jade: #2d8a6e;
  /* ... */
}
```

### Game Rules
Modify `src/game.js` for:
- Scoring system
- Winning conditions
- Tile set

## 📝 License

MIT License - free for personal and commercial use.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 🙏 Credits

- Mahjong tile Unicode characters
- Socket.IO for real-time communication
- SQLite for zero-config database

---

**Enjoy playing! 祝你好運!** 🀄
