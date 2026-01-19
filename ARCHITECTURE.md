# 🀄 Mahjong Online - System Architecture

## 🌐 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RENDER.COM (Hosting)                                 │
│                    https://mahjong-owe1.onrender.com                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                        NODE.JS SERVER                                 │  │
│   │                         (server.js)                                   │  │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│   │  │   Express   │  │  Socket.IO  │  │     JWT     │  │   bcrypt    │  │  │
│   │  │  REST API   │  │  Real-time  │  │    Auth     │  │  Passwords  │  │  │
│   │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                      STATIC FILES (docs/)                             │  │
│   │                        index.html (UI)                                │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────────────┐
│    SUPABASE     │      │    DEEPSEEK     │      │        GITHUB           │
│   (Database)    │      │   (AI Chat)     │      │    (Source Code)        │
│   PostgreSQL    │      │     API         │      │   Auto-deploy hook      │
└─────────────────┘      └─────────────────┘      └─────────────────────────┘
```

---

## 📁 File Structure

```
Mahjong/
│
├── 📂 docs/                    # Frontend (served as static files)
│   └── index.html              # Single-page app (HTML + CSS + JS)
│
├── 📂 src/                     # Backend
│   ├── server.js               # Main server (Express + Socket.IO)
│   ├── database.js             # Supabase database layer
│   └── game.js                 # Mahjong game logic + AI
│
├── package.json                # Dependencies
└── README.md                   # Documentation
```

---

## 🔄 Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         index.html                                    │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │  │
│  │  │    HTML    │  │    CSS     │  │ JavaScript │  │  Socket.IO     │  │  │
│  │  │   Views    │  │   Styles   │  │   Logic    │  │    Client      │  │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                │                                           │
                │ HTTP (REST API)                           │ WebSocket
                │ • POST /api/register                      │ • Real-time game
                │ • POST /api/login                         │ • Chat messages
                │ • GET /api/leaderboard                    │ • Player actions
                ▼                                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              server.js                                      │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │         REST API Layer          │  │       Socket.IO Layer           │  │
│  │  • /api/register                │  │  • createRoom                   │  │
│  │  • /api/login                   │  │  • joinRoom                     │  │
│  │  • /api/logout                  │  │  • startGame                    │  │
│  │  • /api/me                      │  │  • discardTile                  │  │
│  │  • /api/leaderboard             │  │  • claimPung/Kong/Chow          │  │
│  │  • /api/lobbies                 │  │  • mahjong (win)                │  │
│  │                                 │  │  • chat                         │  │
│  └─────────────────────────────────┘  └─────────────────────────────────┘  │
│                    │                                │                       │
│                    ▼                                ▼                       │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │        database.js              │  │          game.js                │  │
│  │   • createUser()                │  │   • MahjongGame class           │  │
│  │   • authenticateUser()          │  │   • Tile dealing                │  │
│  │   • getLeaderboard()            │  │   • Turn management             │  │
│  │   • updatePlayerStats()         │  │   • Claim validation            │  │
│  │   • createGame()                │  │   • Win detection               │  │
│  │   • endGame()                   │  │   • AI player logic             │  │
│  └─────────────────────────────────┘  └─────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
                │                                           │
                ▼                                           ▼
┌───────────────────────────────┐            ┌───────────────────────────────┐
│          SUPABASE             │            │          DEEPSEEK             │
│  ┌─────────────────────────┐  │            │  ┌─────────────────────────┐  │
│  │        users            │  │            │  │    AI Chat API          │  │
│  │  • id                   │  │            │  │  • Reads chat history   │  │
│  │  • username             │  │            │  │  • Generates response   │  │
│  │  • password_hash        │  │            │  │  • Bilingual (EN/CN)    │  │
│  │  • display_name         │  │            │  │  • 40% response rate    │  │
│  │  • is_online            │  │            │  └─────────────────────────┘  │
│  └─────────────────────────┘  │            └───────────────────────────────┘
│  ┌─────────────────────────┐  │
│  │     player_stats        │  │
│  │  • user_id              │  │
│  │  • games_played         │  │
│  │  • games_won            │  │
│  │  • total_score          │  │
│  │  • highest_score        │  │
│  │  • win_streak           │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │        games            │  │
│  │  • id                   │  │
│  │  • room_code            │  │
│  │  • started_at           │  │
│  │  • ended_at             │  │
│  │  • winner_id            │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

---

## 🎮 Game Logic Flow (game.js)

```
                            ┌─────────────────┐
                            │   Game Start    │
                            │  (4 players)    │
                            └────────┬────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  Shuffle Tiles  │
                            │   (144 tiles)   │
                            └────────┬────────┘
                                     │
                                     ▼
                            ┌─────────────────┐
                            │  Deal 13 tiles  │
                            │  to each player │
                            └────────┬────────┘
                                     │
                                     ▼
              ┌──────────────────────┴──────────────────────┐
              │                GAME LOOP                    │
              │  ┌────────────────────────────────────────┐ │
              │  │         Current Player Turn            │ │
              │  └───────────────────┬────────────────────┘ │
              │                      │                      │
              │                      ▼                      │
              │           ┌─────────────────────┐           │
              │           │    Draw Tile        │           │
              │           │  (from wall)        │           │
              │           └──────────┬──────────┘           │
              │                      │                      │
              │                      ▼                      │
              │           ┌─────────────────────┐           │
              │           │  Can declare win?   │───Yes───▶ WIN!
              │           └──────────┬──────────┘           │
              │                      │ No                   │
              │                      ▼                      │
              │           ┌─────────────────────┐           │
              │           │   Discard Tile      │           │
              │           └──────────┬──────────┘           │
              │                      │                      │
              │                      ▼                      │
              │    ┌─────────────────────────────────────┐  │
              │    │      Other Players Check            │  │
              │    │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐ │  │
              │    │  │ Win │  │Kong │  │Pung │  │Chow │ │  │
              │    │  │ 胡  │  │ 槓  │  │ 碰  │  │ 吃  │ │  │
              │    │  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘ │  │
              │    └─────┼───────┼────────┼────────┼─────┘  │
              │          │       │        │        │        │
              │          ▼       ▼        ▼        ▼        │
              │    ┌─────────────────────────────────────┐  │
              │    │  Claim? → Claimer's turn            │  │
              │    │  No claim? → Next player's turn     │  │
              │    └─────────────────────────────────────┘  │
              │                      │                      │
              │                      │                      │
              └──────────────────────┴──────────────────────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                         ▼                       ▼
               ┌─────────────────┐     ┌─────────────────┐
               │    WINNER!      │     │     DRAW        │
               │  (valid hand)   │     │  (wall empty)   │
               └─────────────────┘     └─────────────────┘
```

---

## 🤖 AI Player Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI DECISION TREE                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  AI's Turn?     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     ┌─────────────────┐          ┌─────────────────┐
     │   DRAW PHASE    │          │   CLAIM PHASE   │
     │ (AI draws tile) │          │ (Someone else   │
     │                 │          │  discarded)     │
     └────────┬────────┘          └────────┬────────┘
              │                            │
              ▼                            ▼
     ┌─────────────────┐          ┌─────────────────┐
     │ Analyze hand    │          │ Check options:  │
     │ Find best       │          │ • Win? (100%)   │
     │ discard         │          │ • Kong? (80%)   │
     └────────┬────────┘          │ • Pung? (70%)   │
              │                   │ • Chow? (40%)   │
              ▼                   └────────┬────────┘
     ┌─────────────────┐                   │
     │ DISCARD LOGIC:  │                   ▼
     │ Priority:       │          ┌─────────────────┐
     │ 1. Isolated     │          │ Random chance   │
     │    honors       │          │ to claim or     │
     │ 2. Edge tiles   │          │ pass            │
     │    (1,9)        │          └─────────────────┘
     │ 3. Isolated     │
     │    tiles        │
     │ 4. Random       │
     └─────────────────┘
```

---

## 💬 AI Chat Flow (DeepSeek)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Human sends    │────▶│  Server checks  │────▶│  Rate limit OK? │
│  chat message   │     │  cooldown (15s) │     │  (40% chance)   │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  Build prompt   │
                                               │  with last 5    │
                                               │  messages       │
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  Call DeepSeek  │
                                               │  API            │
                                               │  (60 tokens max)│
                                               └────────┬────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │  AI responds    │
                                               │  in same        │
                                               │  language       │
                                               └─────────────────┘
```

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  ENVIRONMENT VARIABLES (Never in code)                          │
│  • JWT_SECRET         - Token signing                           │
│  • SUPABASE_URL       - Database connection                     │
│  • SUPABASE_KEY       - Database auth                           │
│  • DEEPSEEK_KEY       - AI API auth                             │
│  • ALLOWED_ORIGIN     - CORS restriction                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  RATE LIMITING                                                   │
│  • Register: 5 requests / 5 minutes per IP                      │
│  • Login: 10 requests / 1 minute per IP                         │
│  • Chat: 20 messages / 1 minute per socket                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  INPUT SANITIZATION                                              │
│  • Strip < > characters (XSS prevention)                        │
│  • Limit string lengths                                         │
│  • JSON body limit: 10kb                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  AUTHENTICATION                                                  │
│  • Passwords: bcrypt (10 rounds)                                │
│  • Tokens: JWT (30-day expiry)                                  │
│  • Cookies: httpOnly, secure, sameSite: strict                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CORS                                                            │
│  • Only allows: https://mahjong-owe1.onrender.com               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema (Supabase/PostgreSQL)

```
┌─────────────────────────────────────────────────────────────────┐
│                          USERS                                   │
├─────────────────────────────────────────────────────────────────┤
│  id              SERIAL PRIMARY KEY                             │
│  username        TEXT UNIQUE NOT NULL                           │
│  password_hash   TEXT NOT NULL                                  │
│  display_name    TEXT NOT NULL                                  │
│  is_online       BOOLEAN DEFAULT FALSE                          │
│  created_at      TIMESTAMP DEFAULT NOW()                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:1
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PLAYER_STATS                               │
├─────────────────────────────────────────────────────────────────┤
│  user_id         INTEGER PRIMARY KEY REFERENCES users(id)       │
│  games_played    INTEGER DEFAULT 0                              │
│  games_won       INTEGER DEFAULT 0                              │
│  total_score     INTEGER DEFAULT 0                              │
│  highest_score   INTEGER DEFAULT 0                              │
│  win_streak      INTEGER DEFAULT 0                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          GAMES                                   │
├─────────────────────────────────────────────────────────────────┤
│  id              SERIAL PRIMARY KEY                             │
│  room_code       TEXT NOT NULL                                  │
│  started_at      TIMESTAMP DEFAULT NOW()                        │
│  ended_at        TIMESTAMP                                      │
│  winner_id       INTEGER REFERENCES users(id)                   │
│  status          TEXT DEFAULT 'active'                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 1:N
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GAME_PARTICIPANTS                             │
├─────────────────────────────────────────────────────────────────┤
│  id              SERIAL PRIMARY KEY                             │
│  game_id         INTEGER REFERENCES games(id)                   │
│  user_id         INTEGER REFERENCES users(id)                   │
│  seat_wind       TEXT (E/S/W/N)                                 │
│  final_score     INTEGER DEFAULT 0                              │
│  is_winner       BOOLEAN DEFAULT FALSE                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎨 Frontend Components (index.html)

```
┌─────────────────────────────────────────────────────────────────┐
│                     SINGLE PAGE APP                              │
│                      (index.html)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│    SCREENS    │     │    STYLES     │     │   JAVASCRIPT  │
│               │     │               │     │               │
│ • Loading     │     │ • Variables   │     │ • Socket.IO   │
│ • Auth        │     │ • Layout      │     │ • REST calls  │
│ • Lobby       │     │ • Components  │     │ • Game state  │
│ • Waiting     │     │ • Tiles       │     │ • UI updates  │
│ • Game        │     │ • Responsive  │     │ • Event       │
│ • Win Modal   │     │ • Animations  │     │   handlers    │
└───────────────┘     └───────────────┘     └───────────────┘

SCREEN FLOW:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Loading  │───▶│   Auth   │───▶│  Lobby   │───▶│ Waiting  │
└──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                     ▲                               │
                     │                               ▼
                     │                          ┌──────────┐
                     └──────────────────────────│   Game   │
                          (logout/leave)        └────┬─────┘
                                                     │
                                                     ▼
                                                ┌──────────┐
                                                │ Win Modal│
                                                └──────────┘
```

---

## 🔧 Tech Stack Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        TECH STACK                                │
├─────────────────┬───────────────────────────────────────────────┤
│  FRONTEND       │  HTML5, CSS3, Vanilla JavaScript              │
│                 │  Socket.IO Client                             │
│                 │  Google Fonts (Ma Shan Zheng)                 │
├─────────────────┼───────────────────────────────────────────────┤
│  BACKEND        │  Node.js 18+                                  │
│                 │  Express.js (REST API)                        │
│                 │  Socket.IO (WebSockets)                       │
│                 │  JWT (Authentication)                         │
│                 │  bcryptjs (Password hashing)                  │
├─────────────────┼───────────────────────────────────────────────┤
│  DATABASE       │  Supabase (PostgreSQL)                        │
├─────────────────┼───────────────────────────────────────────────┤
│  AI             │  DeepSeek Chat API                            │
├─────────────────┼───────────────────────────────────────────────┤
│  HOSTING        │  Render.com (Free tier)                       │
├─────────────────┼───────────────────────────────────────────────┤
│  VERSION CTRL   │  GitHub (Auto-deploy)                         │
└─────────────────┴───────────────────────────────────────────────┘
```

---

## 📊 Tile Set (144 tiles)

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAHJONG TILE SET                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUITS (4 of each, 108 total):                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  萬 Characters (萬子)  │  一萬 二萬 三萬 四萬 五萬 六萬 七萬 八萬 九萬 ││
│  │  筒 Dots (筒子)        │  🀙 🀚 🀛 🀜 🀝 🀞 🀟 🀠 🀡          ││
│  │  條 Bamboo (條子)      │  🀐 🀑 🀒 🀓 🀔 🀕 🀖 🀗 🀘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  HONORS (4 of each, 28 total):                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Winds (風牌)    │  東 南 西 北                              ││
│  │  Dragons (三元)  │  中 發 白                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  BONUS (1 of each, 8 total):                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Flowers (花牌)  │  🀢 🀣 🀤 🀥                              ││
│  │  Seasons (季牌)  │  🀦 🀧 🀨 🀩                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

*Architecture Document - Last Updated: January 2025*
