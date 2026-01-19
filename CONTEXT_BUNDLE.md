# 🀄 Mahjong Online - Project Context Bundle
**For continuing development in new Claude chat**

---

## 🎮 Project Summary

**Live URL:** https://mahjong-owe1.onrender.com/
**GitHub:** https://github.com/GreggDispenza/Mahjong
**Owner:** Gregg Dispenza

A 4-player Hong Kong-style Mahjong game with:
- User accounts (register/login)
- Real-time multiplayer via WebSockets
- AI opponents (can play solo with 3 AI)
- AI chat (DeepSeek API, bilingual EN/CN)
- Leaderboards
- Mobile responsive

---

## 📁 File Structure

```
Mahjong/
├── docs/
│   └── index.html      # Frontend (single HTML file with CSS+JS)
├── src/
│   ├── server.js       # Express + Socket.IO + AI chat
│   ├── database.js     # Supabase PostgreSQL layer
│   └── game.js         # Mahjong game logic + AI players
└── package.json
```

---

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML + CSS + JS (single file) |
| Backend | Node.js + Express + Socket.IO |
| Database | Supabase (PostgreSQL) |
| Auth | JWT + bcryptjs |
| AI Chat | DeepSeek API |
| Hosting | Render.com (auto-deploy from GitHub) |

---

## 🔐 Environment Variables (Render)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Token signing (32+ chars) |
| `SUPABASE_URL` | `https://lexgvescxcmzwfympppf.supabase.co` |
| `SUPABASE_KEY` | Supabase anon key |
| `DEEPSEEK_KEY` | DeepSeek API key (user has new one) |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGIN` | `https://mahjong-owe1.onrender.com` |

**All keys removed from code - env vars only (security fix applied)**

---

## 🗄️ Database Schema (Supabase)

```sql
-- users
id SERIAL PRIMARY KEY
username TEXT UNIQUE
password_hash TEXT
display_name TEXT
is_online BOOLEAN
created_at TIMESTAMP

-- player_stats
user_id INTEGER PRIMARY KEY REFERENCES users(id)
games_played INTEGER
games_won INTEGER
total_score INTEGER
highest_score INTEGER
win_streak INTEGER

-- games
id SERIAL PRIMARY KEY
room_code TEXT
started_at TIMESTAMP
ended_at TIMESTAMP
winner_id INTEGER
status TEXT

-- game_participants
id SERIAL PRIMARY KEY
game_id INTEGER REFERENCES games(id)
user_id INTEGER REFERENCES users(id)
seat_wind TEXT
final_score INTEGER
is_winner BOOLEAN
```

---

## 🤖 AI Features

### AI Players
- Names: 電腦東, 電腦南, 電腦西, 電腦北
- Claim rates: Win 100%, Kong 80%, Pung 70%, Chow 40%
- Discard priority: isolated honors → edge tiles → isolated → random

### AI Chat (DeepSeek)
- Reads last 5 messages
- Responds in same language (EN/CN/mixed)
- 40% response rate, 15sec cooldown
- Game event reactions: "碰！" "Kong!" etc.

---

## 🔒 Security Measures Applied

- ✅ API keys in env vars only (not in code)
- ✅ CORS restricted to production domain
- ✅ Rate limiting (register: 5/5min, login: 10/min, chat: 20/min)
- ✅ Input sanitization (strips `<>`, length limits)
- ✅ Secure cookies (httpOnly, secure, sameSite: strict)
- ✅ Password min 6 chars, bcrypt 10 rounds
- ✅ Debug endpoint hidden in production
- ✅ Generic login error (prevents username enumeration)

---

## 🎨 UI Details

- Traditional Chinese aesthetic (cream/ivory/green felt)
- Bilingual buttons: 吃 Chow, 碰 Pung, 槓 Kong, 胡 Mahjong, 過 Skip
- Hand tiles: single row, horizontal scroll on mobile
- 3 responsive breakpoints: 700px, 500px, 380px
- Music toggle button (Chinese instrumental, off by default)
- Slide-out chat panel

---

## 📋 Current Tile Sizes (index_v6.html)

| Element | Desktop | Mobile (500px) |
|---------|---------|----------------|
| Hand tile | 36×50px | 28×38px |
| Meld tile | 28×38px | 22×30px |
| Discard tile | 24×32px | 18×24px |
| Last discard | 40×54px | 30×40px |

---

## 🚀 Deployment Workflow

1. Edit files locally or download from Claude
2. Update in GitHub (`docs/index.html`, `src/*.js`)
3. Push to main branch
4. Render auto-deploys (2-3 min)

---

## 📝 Recent Issues & Fixes

| Issue | Status |
|-------|--------|
| Tiles in 2 rows | Fixed in v6 (smaller tiles) |
| API keys hardcoded | Fixed (env vars) |
| No rate limiting | Fixed |
| CORS too open | Fixed (domain restricted) |
| Music missing | Added (toggle button) |

---

## 🔜 Potential Future Work

- Tile graphics still could be clearer (user mentioned)
- Test thoroughly on actual smartphone
- Scoring system refinement
- More win conditions
- Sound effects for actions
- Spectator mode

---

## 📎 Key Files Reference

When continuing work, these are the latest versions:
- `index_v6.html` → goes to `docs/index.html`
- `server.js` → goes to `src/server.js`
- `database.js` → goes to `src/database.js`
- `game.js` → goes to `src/game.js`

---

## 💬 User Preferences

- Prefers bilingual (English + Traditional Chinese)
- Wants clear, readable tile graphics
- Mobile responsiveness important
- Cost-conscious (chose DeepSeek for cheaper AI)
- Security-aware (asked for security audit)

---

*Bundle created: January 2025*
*Last working version: v6*
