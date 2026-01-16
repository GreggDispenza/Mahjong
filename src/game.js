// Mahjong Game Engine with AI Players

const SUITS = ['bamboo', 'character', 'circle'];
const WINDS = ['east', 'south', 'west', 'north'];
const DRAGONS = ['red', 'green', 'white'];

const TILE_CHARS = {
  bamboo: ['🀐', '🀑', '🀒', '🀓', '🀔', '🀕', '🀖', '🀗', '🀘'],
  character: ['🀇', '🀈', '🀉', '🀊', '🀋', '🀌', '🀍', '🀎', '🀏'],
  circle: ['🀙', '🀚', '🀛', '🀜', '🀝', '🀞', '🀟', '🀠', '🀡'],
  wind: { east: '🀀', south: '🀁', west: '🀂', north: '🀃' },
  dragon: { red: '🀄', green: '🀅', white: '🀆' },
  flower: ['🀢', '🀣', '🀤', '🀥'],
  season: ['🀦', '🀧', '🀨', '🀩'],
  back: '🀫'
};

const AI_NAMES = ['電腦東', '電腦南', '電腦西', '電腦北'];

function createTileSet() {
  const tiles = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let num = 1; num <= 9; num++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ id: id++, type: 'suited', suit, value: num, char: TILE_CHARS[suit][num - 1] });
      }
    }
  }
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, type: 'honor', suit: 'wind', value: wind, char: TILE_CHARS.wind[wind] });
    }
  }
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, type: 'honor', suit: 'dragon', value: dragon, char: TILE_CHARS.dragon[dragon] });
    }
  }
  for (let i = 0; i < 4; i++) {
    tiles.push({ id: id++, type: 'bonus', suit: 'flower', value: i + 1, char: TILE_CHARS.flower[i] });
  }
  for (let i = 0; i < 4; i++) {
    tiles.push({ id: id++, type: 'bonus', suit: 'season', value: i + 1, char: TILE_CHARS.season[i] });
  }
  return tiles;
}

function shuffleTiles(tiles) {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tilesMatch(a, b) { return a.suit === b.suit && a.value === b.value; }

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const order = { bamboo: 0, character: 1, circle: 2, wind: 3, dragon: 4 };
    const diff = (order[a.suit] || 5) - (order[b.suit] || 5);
    if (diff !== 0) return diff;
    if (typeof a.value === 'number' && typeof b.value === 'number') return a.value - b.value;
    return String(a.value).localeCompare(String(b.value));
  });
}

class MahjongGame {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = {};
    this.playerOrder = [];
    this.wall = [];
    this.discardPile = [];
    this.currentTurn = 0;
    this.phase = 'waiting';
    this.roundWind = 'east';
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.gameId = null;
    this.createdAt = Date.now();
    this.aiPlayers = new Set();
  }

  addPlayer(socketId, oderId, displayName, avatar) {
    if (this.playerOrder.length >= 4) return { success: false, error: 'Room is full' };
    if (this.phase !== 'waiting') return { success: false, error: 'Game already started' };

    const seatWind = WINDS[this.playerOrder.length];
    this.players[socketId] = {
      oderId, socketId, displayName, avatar, seatWind,
      hand: [], exposed: [], flowers: [], discards: [], score: 0, isReady: false, isAI: false
    };
    this.playerOrder.push(socketId);
    return { success: true, seatWind, playerCount: this.playerOrder.length };
  }

  addAIPlayers() {
    while (this.playerOrder.length < 4) {
      const aiId = `ai_${Date.now()}_${this.playerOrder.length}`;
      const seatWind = WINDS[this.playerOrder.length];
      const name = AI_NAMES[this.playerOrder.length] || `AI ${this.playerOrder.length + 1}`;
      this.players[aiId] = {
        oderId: -this.playerOrder.length - 1,
        socketId: aiId,
        displayName: name,
        avatar: 'ai',
        seatWind,
        hand: [], exposed: [], flowers: [], discards: [], score: 0, isReady: true, isAI: true
      };
      this.playerOrder.push(aiId);
      this.aiPlayers.add(aiId);
    }
    return { success: true, playerCount: 4 };
  }

  removePlayer(socketId) {
    if (this.players[socketId]) {
      delete this.players[socketId];
      this.playerOrder = this.playerOrder.filter(id => id !== socketId);
      this.aiPlayers.delete(socketId);
    }
  }

  canStart() { return this.playerOrder.length === 4 && this.phase === 'waiting'; }

  startGame() {
    if (this.playerOrder.length < 4) this.addAIPlayers();
    if (!this.canStart()) return { success: false, error: 'Cannot start' };

    this.phase = 'playing';
    this.wall = shuffleTiles(createTileSet());

    for (let round = 0; round < 3; round++) {
      for (const socketId of this.playerOrder) {
        for (let i = 0; i < 4; i++) this.dealTile(socketId);
      }
    }
    for (const socketId of this.playerOrder) this.dealTile(socketId);
    this.dealTile(this.playerOrder[0]);

    for (const socketId of this.playerOrder) this.replaceFlowers(socketId);
    for (const socketId of this.playerOrder) this.players[socketId].hand = sortHand(this.players[socketId].hand);

    return { success: true };
  }

  dealTile(socketId) {
    if (this.wall.length === 0) return null;
    const tile = this.wall.shift();
    this.players[socketId].hand.push(tile);
    return tile;
  }

  replaceFlowers(socketId) {
    const player = this.players[socketId];
    let replaced = true;
    while (replaced) {
      replaced = false;
      const flowers = player.hand.filter(t => t.type === 'bonus');
      for (const flower of flowers) {
        player.hand = player.hand.filter(t => t.id !== flower.id);
        player.flowers.push(flower);
        if (this.wall.length > 0) {
          const newTile = this.wall.pop();
          player.hand.push(newTile);
          if (newTile.type === 'bonus') replaced = true;
        }
      }
    }
  }

  getCurrentPlayer() { return this.playerOrder[this.currentTurn]; }
  isCurrentPlayerAI() { return this.aiPlayers.has(this.getCurrentPlayer()); }

  discard(socketId, tileId) {
    if (this.phase !== 'playing') return { success: false, error: 'Game not in progress' };
    if (this.getCurrentPlayer() !== socketId) return { success: false, error: 'Not your turn' };

    const player = this.players[socketId];
    const tileIndex = player.hand.findIndex(t => t.id === tileId);
    if (tileIndex === -1) return { success: false, error: 'Tile not in hand' };

    const tile = player.hand.splice(tileIndex, 1)[0];
    player.discards.push(tile);
    this.discardPile.push(tile);
    this.lastDiscard = tile;
    this.lastDiscardPlayer = socketId;

    return { success: true, tile };
  }

  // AI Logic
  aiSelectDiscard(socketId) {
    const player = this.players[socketId];
    if (!player || !player.isAI) return null;

    const hand = player.hand;
    if (hand.length === 0) return null;

    // Simple AI: discard isolated tiles first, keep pairs/sequences
    const counts = {};
    hand.forEach(t => {
      const key = `${t.suit}-${t.value}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    // Score each tile (lower = more likely to discard)
    const scored = hand.map(t => {
      const key = `${t.suit}-${t.value}`;
      let score = counts[key] * 10; // pairs/triplets are valuable

      if (t.type === 'suited') {
        // Check for sequence potential
        const val = t.value;
        const suit = t.suit;
        const hasAdj1 = hand.some(h => h.suit === suit && h.value === val - 1);
        const hasAdj2 = hand.some(h => h.suit === suit && h.value === val + 1);
        if (hasAdj1) score += 5;
        if (hasAdj2) score += 5;
        // Edge tiles less valuable
        if (val === 1 || val === 9) score -= 2;
      }

      if (t.type === 'honor') {
        // Keep honor pairs, discard singles
        if (counts[key] === 1) score -= 5;
      }

      return { tile: t, score };
    });

    // Sort by score ascending, discard lowest
    scored.sort((a, b) => a.score - b.score);
    return scored[0].tile.id;
  }

  aiShouldClaim(socketId, claimType) {
    if (!this.aiPlayers.has(socketId)) return false;
    if (!this.canClaim(socketId, claimType)) return false;

    // AI claims pung/kong 70% of time, chow 40%, mahjong always
    if (claimType === 'mahjong') return true;
    if (claimType === 'kong') return Math.random() < 0.8;
    if (claimType === 'pung') return Math.random() < 0.7;
    if (claimType === 'chow') return Math.random() < 0.4;
    return false;
  }

  getAIChowTiles(socketId) {
    const player = this.players[socketId];
    const tile = this.lastDiscard;
    if (!tile || tile.type !== 'suited') return null;

    const suit = tile.suit;
    const val = tile.value;
    const suitTiles = player.hand.filter(t => t.type === 'suited' && t.suit === suit);

    const sequences = [
      [val - 2, val - 1],
      [val - 1, val + 1],
      [val + 1, val + 2]
    ];

    for (const [a, b] of sequences) {
      if (a >= 1 && b <= 9) {
        const t1 = suitTiles.find(t => t.value === a);
        const t2 = suitTiles.find(t => t.value === b);
        if (t1 && t2) return [t1.id, t2.id];
      }
    }
    return null;
  }

  canClaim(socketId, claimType) {
    if (!this.lastDiscard || this.lastDiscardPlayer === socketId) return false;
    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile));

    switch (claimType) {
      case 'pung': return matching.length >= 2;
      case 'kong': return matching.length >= 3;
      case 'chow':
        const nextPlayer = this.playerOrder[(this.playerOrder.indexOf(this.lastDiscardPlayer) + 1) % 4];
        if (socketId !== nextPlayer) return false;
        if (tile.type !== 'suited') return false;
        return this.canFormChow(player.hand, tile);
      case 'mahjong':
        const testHand = [...player.hand, tile];
        return this.isWinningHand(testHand, player.exposed);
      default: return false;
    }
  }

  canFormChow(hand, tile) {
    if (tile.type !== 'suited') return false;
    const suit = tile.suit;
    const val = tile.value;
    const values = hand.filter(t => t.type === 'suited' && t.suit === suit).map(t => t.value);
    const sequences = [[val - 2, val - 1], [val - 1, val + 1], [val + 1, val + 2]];
    for (const [a, b] of sequences) {
      if (a >= 1 && b <= 9 && values.includes(a) && values.includes(b)) return true;
    }
    return false;
  }

  claimPung(socketId) {
    if (!this.canClaim(socketId, 'pung')) return { success: false, error: 'Cannot claim pung' };
    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile)).slice(0, 2);
    for (const m of matching) player.hand = player.hand.filter(t => t.id !== m.id);
    const meld = { type: 'pung', tiles: [...matching, tile], exposed: true };
    player.exposed.push(meld);
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();
    this.currentTurn = this.playerOrder.indexOf(socketId);
    return { success: true, meld };
  }

  claimKong(socketId) {
    if (!this.canClaim(socketId, 'kong')) return { success: false, error: 'Cannot claim kong' };
    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile)).slice(0, 3);
    for (const m of matching) player.hand = player.hand.filter(t => t.id !== m.id);
    const meld = { type: 'kong', tiles: [...matching, tile], exposed: true };
    player.exposed.push(meld);
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();
    this.currentTurn = this.playerOrder.indexOf(socketId);
    if (this.wall.length > 0) player.hand.push(this.wall.pop());
    return { success: true, meld };
  }

  claimChow(socketId, tileIds) {
    if (!this.canClaim(socketId, 'chow')) return { success: false, error: 'Cannot claim chow' };
    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const tiles = tileIds.map(id => player.hand.find(t => t.id === id)).filter(Boolean);
    if (tiles.length !== 2) return { success: false, error: 'Invalid tiles' };

    const all = [...tiles, tile].sort((a, b) => a.value - b.value);
    if (all[0].suit !== all[1].suit || all[1].suit !== all[2].suit) return { success: false, error: 'Must be same suit' };
    if (all[1].value - all[0].value !== 1 || all[2].value - all[1].value !== 1) return { success: false, error: 'Must be sequence' };

    for (const t of tiles) player.hand = player.hand.filter(h => h.id !== t.id);
    const meld = { type: 'chow', tiles: all, exposed: true };
    player.exposed.push(meld);
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();
    this.currentTurn = this.playerOrder.indexOf(socketId);
    return { success: true, meld };
  }

  nextTurn() {
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.currentTurn = (this.currentTurn + 1) % 4;
    const currentPlayer = this.getCurrentPlayer();
    if (this.wall.length === 0) return { success: true, drawn: true };
    this.dealTile(currentPlayer);
    this.replaceFlowers(currentPlayer);
    this.players[currentPlayer].hand = sortHand(this.players[currentPlayer].hand);
    return { success: true, drawn: false, isAI: this.aiPlayers.has(currentPlayer) };
  }

  isWinningHand(hand, exposed) {
    const total = hand.length + exposed.reduce((sum, m) => sum + (m.type === 'kong' ? 4 : 3), 0);
    if (total !== 14) return false;

    const counts = {};
    hand.forEach(t => {
      const key = `${t.suit}-${t.value}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    const keys = Object.keys(counts);
    for (const pairKey of keys) {
      if (counts[pairKey] >= 2) {
        const testCounts = { ...counts };
        testCounts[pairKey] -= 2;
        if (this.canFormMelds(testCounts)) return true;
      }
    }
    return false;
  }

  canFormMelds(counts) {
    const keys = Object.keys(counts).filter(k => counts[k] > 0);
    if (keys.length === 0) return true;

    const key = keys[0];
    const [suit, valStr] = key.split('-');
    const val = isNaN(parseInt(valStr)) ? valStr : parseInt(valStr);

    // Try pung
    if (counts[key] >= 3) {
      const newCounts = { ...counts };
      newCounts[key] -= 3;
      if (this.canFormMelds(newCounts)) return true;
    }

    // Try chow (only for suited tiles)
    if (typeof val === 'number' && val <= 7) {
      const key2 = `${suit}-${val + 1}`;
      const key3 = `${suit}-${val + 2}`;
      if (counts[key] >= 1 && (counts[key2] || 0) >= 1 && (counts[key3] || 0) >= 1) {
        const newCounts = { ...counts };
        newCounts[key] -= 1;
        newCounts[key2] -= 1;
        newCounts[key3] -= 1;
        if (this.canFormMelds(newCounts)) return true;
      }
    }
    return false;
  }

  declareMahjong(socketId, fromDiscard) {
    const player = this.players[socketId];
    let testHand = [...player.hand];

    if (fromDiscard && this.lastDiscard) {
      testHand.push(this.lastDiscard);
    }

    if (!this.isWinningHand(testHand, player.exposed)) {
      return { success: false, error: 'Not a winning hand' };
    }

    this.phase = 'ended';
    const score = this.calculateScore(player, fromDiscard);

    return {
      success: true,
      score,
      hand: testHand,
      exposed: player.exposed,
      flowers: player.flowers
    };
  }

  calculateScore(player, fromDiscard) {
    let score = 1;
    score += player.flowers.length;
    score += player.exposed.filter(m => m.type === 'kong').length * 2;
    score += player.exposed.filter(m => m.type === 'pung').length;
    if (!fromDiscard) score += 1; // Self-draw bonus
    return Math.max(score, 1) * 10;
  }

  getPlayersInfo() {
    return this.playerOrder.map(socketId => {
      const p = this.players[socketId];
      return { oderId: p.oderId, displayName: p.displayName, seatWind: p.seatWind, avatar: p.avatar, isAI: p.isAI };
    });
  }

  getStateForPlayer(socketId) {
    const player = this.players[socketId];
    const isMyTurn = this.getCurrentPlayer() === socketId;

    return {
      phase: this.phase,
      roundWind: this.roundWind,
      wallCount: this.wall.length,
      myHand: sortHand(player.hand),
      myExposed: player.exposed,
      myFlowers: player.flowers,
      mySeatWind: player.seatWind,
      discardPile: this.discardPile,
      lastDiscard: this.lastDiscard,
      isMyTurn,
      currentPlayer: this.getCurrentPlayer(),
      canPung: this.canClaim(socketId, 'pung'),
      canKong: this.canClaim(socketId, 'kong'),
      canChow: this.canClaim(socketId, 'chow'),
      canMahjong: this.canClaim(socketId, 'mahjong') || (isMyTurn && this.isWinningHand(player.hand, player.exposed)),
      players: this.playerOrder.map(pid => {
        const p = this.players[pid];
        return {
          oderId: p.oderId,
          displayName: p.displayName,
          seatWind: p.seatWind,
          handCount: p.hand.length,
          exposed: p.exposed,
          flowers: p.flowers,
          isAI: p.isAI
        };
      })
    };
  }
}

export { MahjongGame };
