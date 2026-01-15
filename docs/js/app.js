// Mahjong Online - Client Application
const API_URL = '';
let socket = null;
let currentUser = null;
let currentRoom = null;
let gameState = null;
let selectedTiles = [];

// ==================== UTILITIES ====================

async function api(endpoint, options = {}) {
  const res = await fetch(API_URL + endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include'
  });
  return res.json();
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    setTimeout(() => el.textContent = '', 5000);
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ==================== AUTH ====================

async function checkAuth() {
  try {
    const data = await api('/api/me');
    if (data.user) {
      currentUser = data.user;
      initSocket();
      showLobby();
      return true;
    }
  } catch (e) {}
  showScreen('auth-screen');
  return false;
}

async function login(username, password) {
  const data = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  
  if (data.success) {
    currentUser = data.user;
    localStorage.setItem('token', data.token);
    initSocket();
    showLobby();
  } else {
    showError('login-error', data.error || 'Login failed');
  }
}

async function register(username, password, displayName, email) {
  const data = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, displayName, email: email || undefined })
  });
  
  if (data.success) {
    currentUser = data.user;
    localStorage.setItem('token', data.token);
    initSocket();
    showLobby();
  } else {
    showError('register-error', data.error || 'Registration failed');
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  localStorage.removeItem('token');
  currentUser = null;
  if (socket) socket.disconnect();
  showScreen('auth-screen');
}

// ==================== SOCKET ====================

function initSocket() {
  socket = io({
    transports: ['websocket', 'polling']
  });
  
  const token = localStorage.getItem('token');
  
  socket.on('connect', () => {
    console.log('Socket connected');
    if (token) {
      socket.emit('auth', token, (res) => {
        if (!res.success) {
          console.error('Socket auth failed:', res.error);
          logout();
        }
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
  
  // Lobby events
  socket.on('lobbyCreated', updateLobbies);
  socket.on('lobbyUpdated', updateLobbies);
  socket.on('lobbyRemoved', ({ roomCode }) => {
    const card = document.querySelector(`.lobby-card[data-room="${roomCode}"]`);
    if (card) card.remove();
    checkEmptyLobbies();
  });
  
  socket.on('playerOnline', updateOnlinePlayers);
  socket.on('playerOffline', updateOnlinePlayers);
  
  // Room events
  socket.on('playerJoined', updateWaitingRoom);
  socket.on('playerLeft', updateWaitingRoom);
  socket.on('readyToStart', ({ players }) => {
    updateWaitingRoom({ players });
    const btn = document.getElementById('start-game-btn');
    btn.disabled = false;
    btn.textContent = 'Start Game!';
  });
  
  // Game events
  socket.on('gameStarted', handleGameStart);
  socket.on('stateUpdate', handleStateUpdate);
  socket.on('tileDiscarded', handleTileDiscarded);
  socket.on('meldClaimed', handleMeldClaimed);
  socket.on('gameWon', handleGameWon);
  socket.on('gameDraw', handleGameDraw);
  socket.on('chat', handleChatMessage);
}

// ==================== LOBBY ====================

function showLobby() {
  showScreen('lobby-screen');
  document.getElementById('lobby-username').textContent = currentUser.displayName;
  loadLobbies();
  loadOnlinePlayers();
  loadLeaderboard();
  loadHistory();
  loadProfile();
}

async function loadLobbies() {
  const data = await api('/api/lobbies');
  const list = document.getElementById('lobbies-list');
  
  if (data.length === 0) {
    list.innerHTML = '<div class="empty-state">No open rooms. Create one!</div>';
    return;
  }
  
  list.innerHTML = data.map(lobby => `
    <div class="lobby-card" data-room="${lobby.roomCode}" onclick="joinRoom('${lobby.roomCode}')">
      <div class="lobby-card-header">
        <span class="lobby-code">${lobby.roomCode}</span>
        <span class="lobby-count">${lobby.playerCount}/4</span>
      </div>
      <div class="lobby-players">
        ${lobby.players.map(p => `<span class="lobby-player">${p.displayName}</span>`).join('')}
      </div>
    </div>
  `).join('');
}

function updateLobbies() {
  loadLobbies();
}

function checkEmptyLobbies() {
  const list = document.getElementById('lobbies-list');
  if (!list.querySelector('.lobby-card')) {
    list.innerHTML = '<div class="empty-state">No open rooms. Create one!</div>';
  }
}

async function loadOnlinePlayers() {
  const data = await api('/api/online');
  const list = document.getElementById('online-list');
  const count = document.getElementById('online-count');
  
  count.textContent = data.length;
  list.innerHTML = data.map(p => `
    <div class="online-player">
      <span class="online-dot"></span>
      ${p.display_name || p.displayName}
    </div>
  `).join('');
}

function updateOnlinePlayers() {
  loadOnlinePlayers();
}

async function loadLeaderboard() {
  const sortBy = document.getElementById('leaderboard-sort')?.value || 'total_score';
  const data = await api(`/api/leaderboard?sort=${sortBy}`);
  const table = document.getElementById('leaderboard-table');
  
  table.innerHTML = `
    <div class="leaderboard-row header">
      <div>Rank</div>
      <div>Player</div>
      <div>Score</div>
      <div>Wins</div>
      <div>Win Rate</div>
      <div>Mahjong</div>
    </div>
    ${data.map((p, i) => `
      <div class="leaderboard-row">
        <div class="leaderboard-rank">${i + 1}</div>
        <div class="leaderboard-player">
          <span class="leaderboard-avatar">🀄</span>
          <span class="leaderboard-name">${p.display_name}</span>
          ${p.is_online ? '<span class="online-dot" style="margin-left:8px"></span>' : ''}
        </div>
        <div>${p.total_score.toLocaleString()}</div>
        <div>${p.games_won}</div>
        <div>${p.win_rate}%</div>
        <div>${p.mahjong_count}</div>
      </div>
    `).join('')}
  `;
}

async function loadHistory() {
  if (!currentUser) return;
  const data = await api(`/api/history/${currentUser.id}`);
  const list = document.getElementById('history-list');
  
  if (data.length === 0) {
    list.innerHTML = '<div class="empty-state">No games played yet</div>';
    return;
  }
  
  list.innerHTML = data.map(g => `
    <div class="history-item">
      <div>
        <div class="history-room">Room ${g.room_code}</div>
        <div class="history-date">${formatDate(g.ended_at)}</div>
      </div>
      <div class="history-wind">${g.seat_wind.charAt(0).toUpperCase() + g.seat_wind.slice(1)}</div>
      <div class="history-result ${g.is_winner ? 'win' : 'loss'}">${g.is_winner ? 'Won' : 'Lost'}</div>
      <div class="history-score">${g.final_score}</div>
    </div>
  `).join('');
}

async function loadProfile() {
  if (!currentUser) return;
  const data = await api(`/api/me`);
  const card = document.getElementById('profile-card');
  
  const stats = data.stats || {};
  card.innerHTML = `
    <div class="profile-avatar">🀄</div>
    <div class="profile-name">${data.user.display_name}</div>
    <div class="profile-username">@${data.user.username}</div>
    <div class="profile-stats">
      <div class="stat-item">
        <div class="stat-value">${stats.games_played || 0}</div>
        <div class="stat-label">Games</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.games_won || 0}</div>
        <div class="stat-label">Wins</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.total_score || 0}</div>
        <div class="stat-label">Score</div>
      </div>
    </div>
  `;
}

// ==================== ROOM ====================

function createRoom() {
  socket.emit('createRoom', (res) => {
    if (res.success) {
      currentRoom = res.roomCode;
      showWaitingRoom(res.roomCode, res.players, res.seatWind);
    } else {
      alert(res.error || 'Failed to create room');
    }
  });
}

function joinRoom(roomCode) {
  roomCode = roomCode.toUpperCase();
  socket.emit('joinRoom', roomCode, (res) => {
    if (res.success) {
      currentRoom = res.roomCode;
      showWaitingRoom(res.roomCode, res.players, res.seatWind);
    } else {
      alert(res.error || 'Failed to join room');
    }
  });
}

function showWaitingRoom(roomCode, players, mySeatWind) {
  showScreen('waiting-screen');
  document.getElementById('waiting-room-code').textContent = roomCode;
  updateWaitingRoom({ players, mySeatWind });
}

function updateWaitingRoom({ players, mySeatWind, playerCount }) {
  if (!players && playerCount !== undefined) {
    // Simple update, just reload
    return;
  }
  
  const seats = document.querySelectorAll('.seat');
  seats.forEach(seat => {
    const wind = seat.dataset.wind;
    const player = players?.find(p => p.seatWind === wind);
    const playerEl = seat.querySelector('.seat-player');
    
    seat.classList.remove('occupied', 'me');
    
    if (player) {
      playerEl.textContent = player.displayName;
      playerEl.classList.remove('empty');
      seat.classList.add('occupied');
      if (player.oderId === currentUser.id) {
        seat.classList.add('me');
      }
    } else {
      playerEl.textContent = 'Waiting...';
      playerEl.classList.add('empty');
    }
  });
  
  const btn = document.getElementById('start-game-btn');
  if (players?.length === 4) {
    btn.disabled = false;
    btn.textContent = 'Start Game!';
  } else {
    btn.disabled = true;
    btn.textContent = `Waiting for players... (${players?.length || 0}/4)`;
  }
}

function leaveRoom() {
  socket.emit('leaveRoom');
  currentRoom = null;
  showLobby();
}

function startGame() {
  socket.emit('startGame', (res) => {
    if (!res.success) {
      alert(res.error || 'Failed to start game');
    }
  });
}

// ==================== GAME ====================

function handleGameStart(state) {
  gameState = state;
  showScreen('game-screen');
  renderGame();
}

function handleStateUpdate(state) {
  gameState = state;
  renderGame();
}

function handleTileDiscarded({ oderId, tile }) {
  // Visual feedback for discard
  if (gameState) {
    renderGame();
  }
}

function handleMeldClaimed({ oderId, type, meld }) {
  // Visual feedback for meld
}

function handleGameWon({ winnerId, winnerName, score, hand, exposed, flowers }) {
  document.getElementById('winner-name').textContent = winnerName;
  document.getElementById('win-score').textContent = score;
  
  const handDiv = document.getElementById('win-hand');
  handDiv.innerHTML = '';
  
  // Show winning hand
  if (hand) {
    hand.forEach(tile => {
      const tileEl = document.createElement('div');
      tileEl.className = 'tile';
      tileEl.textContent = tile.char;
      handDiv.appendChild(tileEl);
    });
  }
  
  // Show exposed melds
  if (exposed) {
    exposed.forEach(meld => {
      meld.tiles.forEach(tile => {
        const tileEl = document.createElement('div');
        tileEl.className = 'tile';
        tileEl.textContent = tile.char;
        handDiv.appendChild(tileEl);
      });
    });
  }
  
  document.getElementById('win-modal').classList.add('active');
}

function handleGameDraw({ reason }) {
  alert('Game Draw: ' + reason);
  backToLobby();
}

function renderGame() {
  if (!gameState) return;
  
  // My hand
  const myHand = document.getElementById('my-hand');
  myHand.innerHTML = '';
  
  if (gameState.myHand) {
    gameState.myHand.forEach(tile => {
      const tileEl = document.createElement('div');
      tileEl.className = 'tile';
      tileEl.dataset.id = tile.id;
      tileEl.textContent = tile.char;
      
      if (selectedTiles.includes(tile.id)) {
        tileEl.classList.add('selected');
      }
      
      if (!gameState.isMyTurn) {
        tileEl.classList.add('disabled');
      }
      
      tileEl.onclick = () => handleTileClick(tile);
      myHand.appendChild(tileEl);
    });
  }
  
  // My exposed
  const myExposed = document.getElementById('my-exposed');
  myExposed.innerHTML = '';
  if (gameState.myExposed) {
    gameState.myExposed.forEach(meld => {
      const meldEl = document.createElement('div');
      meldEl.className = 'meld' + (meld.concealed ? ' concealed' : '');
      meld.tiles.forEach(tile => {
        const tileEl = document.createElement('div');
        tileEl.className = 'tile';
        tileEl.textContent = tile.char;
        meldEl.appendChild(tileEl);
      });
      myExposed.appendChild(meldEl);
    });
  }
  
  // My flowers
  const myFlowers = document.getElementById('my-flowers');
  myFlowers.innerHTML = '';
  if (gameState.myFlowers) {
    gameState.myFlowers.forEach(tile => {
      const tileEl = document.createElement('div');
      tileEl.className = 'flower-tile';
      tileEl.textContent = tile.char;
      myFlowers.appendChild(tileEl);
    });
  }
  
  // My info
  document.getElementById('my-name').textContent = currentUser.displayName;
  document.getElementById('my-wind').textContent = gameState.mySeatWind?.charAt(0).toUpperCase() || '';
  
  // Wall count
  document.getElementById('wall-count').textContent = gameState.wallCount || 0;
  
  // Discard pile
  const discardArea = document.getElementById('discard-area');
  discardArea.innerHTML = '';
  if (gameState.discardPile) {
    gameState.discardPile.forEach(tile => {
      const tileEl = document.createElement('div');
      tileEl.className = 'tile';
      tileEl.textContent = tile.char;
      discardArea.appendChild(tileEl);
    });
  }
  
  // Last discard
  const lastDiscard = document.getElementById('last-discard');
  lastDiscard.innerHTML = '';
  if (gameState.lastDiscard) {
    const tileEl = document.createElement('div');
    tileEl.className = 'tile';
    tileEl.textContent = gameState.lastDiscard.char;
    lastDiscard.appendChild(tileEl);
  }
  
  // Other players
  renderOtherPlayers();
  
  // Action buttons
  updateActionButtons();
  
  // Turn indicator
  const turnIndicator = document.getElementById('turn-indicator');
  if (gameState.isMyTurn) {
    turnIndicator.classList.add('active');
    turnIndicator.textContent = 'Your Turn';
  } else {
    turnIndicator.classList.remove('active');
  }
}

function renderOtherPlayers() {
  if (!gameState || !gameState.players) return;
  
  // Find my index
  const myIndex = gameState.players.findIndex(p => p.oderId === currentUser.id);
  if (myIndex === -1) return;
  
  const positions = ['bottom', 'right', 'top', 'left'];
  
  gameState.players.forEach((player, i) => {
    if (player.oderId === currentUser.id) return;
    
    // Calculate relative position
    const relativeIndex = (i - myIndex + 4) % 4;
    const position = positions[relativeIndex];
    
    const area = document.getElementById(`player-${position}`);
    if (!area) return;
    
    // Update player info
    area.querySelector('.player-name').textContent = player.displayName;
    area.querySelector('.player-wind').textContent = player.seatWind?.charAt(0).toUpperCase() || '';
    
    // Update hidden hand
    const handDiv = area.querySelector('.player-hand');
    handDiv.innerHTML = '';
    for (let j = 0; j < player.handCount; j++) {
      const tile = document.createElement('div');
      tile.className = 'hidden-tile';
      handDiv.appendChild(tile);
    }
    
    // Update exposed melds
    const exposedDiv = area.querySelector('.player-exposed');
    exposedDiv.innerHTML = '';
    if (player.exposed) {
      player.exposed.forEach(meld => {
        const meldEl = document.createElement('div');
        meldEl.className = 'meld' + (meld.concealed ? ' concealed' : '');
        meld.tiles.forEach(tile => {
          const tileEl = document.createElement('div');
          tileEl.className = 'tile small';
          tileEl.textContent = tile.char;
          meldEl.appendChild(tileEl);
        });
        exposedDiv.appendChild(meldEl);
      });
    }
  });
}

function updateActionButtons() {
  const btnChow = document.getElementById('btn-chow');
  const btnPung = document.getElementById('btn-pung');
  const btnKong = document.getElementById('btn-kong');
  const btnMahjong = document.getElementById('btn-mahjong');
  
  btnChow.disabled = !gameState.canChow;
  btnPung.disabled = !gameState.canPung;
  btnKong.disabled = !gameState.canKong;
  btnMahjong.disabled = !gameState.canMahjong;
}

function handleTileClick(tile) {
  if (!gameState.isMyTurn) return;
  
  const index = selectedTiles.indexOf(tile.id);
  
  if (index > -1) {
    // Already selected - discard it
    discardTile(tile.id);
    selectedTiles = [];
  } else {
    // Select tile
    selectedTiles = [tile.id];
  }
  
  renderGame();
}

function discardTile(tileId) {
  socket.emit('discard', tileId, (res) => {
    if (!res.success) {
      console.error('Discard failed:', res.error);
    }
    selectedTiles = [];
  });
}

function claimPung() {
  socket.emit('claimPung', (res) => {
    if (!res.success) alert(res.error);
  });
}

function claimKong() {
  socket.emit('claimKong', (res) => {
    if (!res.success) alert(res.error);
  });
}

function claimChow() {
  // For chow, we need to select 2 tiles from hand
  if (selectedTiles.length === 2) {
    socket.emit('claimChow', selectedTiles, (res) => {
      if (!res.success) alert(res.error);
      selectedTiles = [];
    });
  } else {
    alert('Select 2 tiles from your hand to form a chow');
  }
}

function declareMahjong() {
  const fromDiscard = !!gameState.lastDiscard && gameState.canMahjong;
  socket.emit('mahjong', fromDiscard, (res) => {
    if (!res.success) alert(res.error);
  });
}

function skipClaim() {
  selectedTiles = [];
  renderGame();
}

function backToLobby() {
  document.getElementById('win-modal').classList.remove('active');
  socket.emit('leaveRoom');
  currentRoom = null;
  gameState = null;
  showLobby();
}

// Chat
function handleChatMessage({ oderId, displayName, message, timestamp }) {
  const messages = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message';
  msgEl.innerHTML = `<span class="chat-sender">${displayName}:</span> <span class="chat-text">${message}</span>`;
  messages.appendChild(msgEl);
  messages.scrollTop = messages.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (message && socket) {
    socket.emit('chat', message);
    input.value = '';
  }
}

// ==================== EVENT LISTENERS ====================

document.addEventListener('DOMContentLoaded', () => {
  // Hide loading after init
  setTimeout(() => {
    checkAuth().then(() => {
      document.getElementById('loading').classList.remove('active');
    });
  }, 500);
  
  // Auth tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + '-form').classList.add('active');
    });
  });
  
  // Login form
  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    login(username, password);
  });
  
  // Register form
  document.getElementById('register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const displayName = document.getElementById('reg-display').value;
    const email = document.getElementById('reg-email').value;
    register(username, password, displayName, email);
  });
  
  // Lobby nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.lobby-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.view + '-view').classList.add('active');
    });
  });
  
  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);
  
  // Create/Join room
  document.getElementById('create-room-btn').addEventListener('click', createRoom);
  document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value;
    if (code) joinRoom(code);
  });
  document.getElementById('room-code-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const code = e.target.value;
      if (code) joinRoom(code);
    }
  });
  
  // Waiting room
  document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
  document.getElementById('start-game-btn').addEventListener('click', startGame);
  
  // Game actions
  document.getElementById('btn-pung').addEventListener('click', claimPung);
  document.getElementById('btn-kong').addEventListener('click', claimKong);
  document.getElementById('btn-chow').addEventListener('click', claimChow);
  document.getElementById('btn-mahjong').addEventListener('click', declareMahjong);
  document.getElementById('btn-skip').addEventListener('click', skipClaim);
  
  // Chat
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  
  // Back to lobby
  document.getElementById('back-to-lobby').addEventListener('click', backToLobby);
  
  // Leaderboard sort
  document.getElementById('leaderboard-sort').addEventListener('change', loadLeaderboard);
});

// Expose functions globally for onclick handlers
window.joinRoom = joinRoom;
