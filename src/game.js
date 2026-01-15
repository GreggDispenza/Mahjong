// Mahjong Game Engine - Hong Kong Rules
// Complete tile set, game mechanics, and scoring

const SUITS = ['bamboo', 'character', 'circle'];
const WINDS = ['east', 'south', 'west', 'north'];
const DRAGONS = ['red', 'green', 'white'];

// Unicode Mahjong tiles for display
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

function createTileSet() {
  const tiles = [];
  let id = 0;

  // Suited tiles (3 suits × 9 numbers × 4 copies = 108)
  for (const suit of SUITS) {
    for (let num = 1; num <= 9; num++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({
          id: id++,
          type: 'suited',
          suit,
          value: num,
          char: TILE_CHARS[suit][num - 1]
        });
      }
    }
  }

  // Wind tiles (4 winds × 4 copies = 16)
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id: id++,
        type: 'honor',
        suit: 'wind',
        value: wind,
        char: TILE_CHARS.wind[wind]
      });
    }
  }

  // Dragon tiles (3 dragons × 4 copies = 12)
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({
        id: id++,
        type: 'honor',
        suit: 'dragon',
        value: dragon,
        char: TILE_CHARS.dragon[dragon]
      });
    }
  }

  // Bonus tiles (4 flowers + 4 seasons = 8)
  for (let i = 0; i < 4; i++) {
    tiles.push({
      id: id++,
      type: 'bonus',
      suit: 'flower',
      value: i + 1,
      char: TILE_CHARS.flower[i]
    });
  }
  for (let i = 0; i < 4; i++) {
    tiles.push({
      id: id++,
      type: 'bonus',
      suit: 'season',
      value: i + 1,
      char: TILE_CHARS.season[i]
    });
  }

  return tiles; // 144 total
}

function shuffleTiles(tiles) {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tileKey(tile) {
  return `${tile.suit}-${tile.value}`;
}

function tilesMatch(a, b) {
  return a.suit === b.suit && a.value === b.value;
}

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitOrder = { bamboo: 0, character: 1, circle: 2, wind: 3, dragon: 4 };
    const suitDiff = (suitOrder[a.suit] || 5) - (suitOrder[b.suit] || 5);
    if (suitDiff !== 0) return suitDiff;
    if (typeof a.value === 'number' && typeof b.value === 'number') {
      return a.value - b.value;
    }
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
    this.phase = 'waiting'; // waiting, playing, ended
    this.roundWind = 'east';
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.gameId = null;
    this.createdAt = Date.now();
  }

  addPlayer(socketId, oderId, displayName, avatar) {
    if (this.playerOrder.length >= 4) {
      return { success: false, error: 'Room is full' };
    }
    if (this.phase !== 'waiting') {
      return { success: false, error: 'Game already started' };
    }

    const seatWind = WINDS[this.playerOrder.length];
    this.players[socketId] = {
      oderId,
      socketId,
      displayName,
      avatar,
      seatWind,
      hand: [],
      exposed: [],
      flowers: [],
      discards: [],
      score: 0,
      isReady: false
    };
    this.playerOrder.push(socketId);

    return {
      success: true,
      seatWind,
      playerCount: this.playerOrder.length
    };
  }

  removePlayer(socketId) {
    if (this.players[socketId]) {
      delete this.players[socketId];
      this.playerOrder = this.playerOrder.filter(id => id !== socketId);
    }
  }

  canStart() {
    return this.playerOrder.length === 4 && this.phase === 'waiting';
  }

  startGame() {
    if (!this.canStart()) {
      return { success: false, error: 'Need 4 players to start' };
    }

    this.phase = 'playing';
    this.wall = shuffleTiles(createTileSet());

    // Deal tiles
    for (let round = 0; round < 3; round++) {
      for (const socketId of this.playerOrder) {
        for (let i = 0; i < 4; i++) {
          this.dealTile(socketId);
        }
      }
    }
    // Final tile
    for (const socketId of this.playerOrder) {
      this.dealTile(socketId);
    }
    // East gets extra tile
    this.dealTile(this.playerOrder[0]);

    // Replace flowers
    for (const socketId of this.playerOrder) {
      this.replaceFlowers(socketId);
    }

    // Sort hands
    for (const socketId of this.playerOrder) {
      this.players[socketId].hand = sortHand(this.players[socketId].hand);
    }

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
          const newTile = this.wall.pop(); // Draw from back for replacement
          player.hand.push(newTile);
          if (newTile.type === 'bonus') replaced = true;
        }
      }
    }
  }

  getCurrentPlayer() {
    return this.playerOrder[this.currentTurn];
  }

  discard(socketId, tileId) {
    if (this.phase !== 'playing') {
      return { success: false, error: 'Game not in progress' };
    }
    if (this.getCurrentPlayer() !== socketId) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.players[socketId];
    const tileIndex = player.hand.findIndex(t => t.id === tileId);

    if (tileIndex === -1) {
      return { success: false, error: 'Tile not in hand' };
    }

    const tile = player.hand.splice(tileIndex, 1)[0];
    player.discards.push(tile);
    this.discardPile.push(tile);
    this.lastDiscard = tile;
    this.lastDiscardPlayer = socketId;

    return { success: true, tile };
  }

  canClaim(socketId, claimType) {
    if (!this.lastDiscard || this.lastDiscardPlayer === socketId) return false;

    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile));

    switch (claimType) {
      case 'pung':
        return matching.length >= 2;
      case 'kong':
        return matching.length >= 3;
      case 'chow':
        // Only from player to the left
        const leftPlayer = this.playerOrder[(this.currentTurn + 1) % 4];
        if (socketId !== leftPlayer) return false;
        if (tile.type !== 'suited') return false;
        return this.canFormChow(player.hand, tile);
      case 'mahjong':
        // Check if adding this tile completes a winning hand
        const testHand = [...player.hand, tile];
        return this.isWinningHand(testHand, player.exposed);
      default:
        return false;
    }
  }

  canFormChow(hand, tile) {
    if (tile.type !== 'suited') return false;
    const suit = tile.suit;
    const val = tile.value;
    const suitTiles = hand.filter(t => t.type === 'suited' && t.suit === suit);
    const values = suitTiles.map(t => t.value);

    // Check possible sequences
    const sequences = [
      [val - 2, val - 1], // tile is third
      [val - 1, val + 1], // tile is middle
      [val + 1, val + 2]  // tile is first
    ];

    for (const [a, b] of sequences) {
      if (a >= 1 && b <= 9 && values.includes(a) && values.includes(b)) {
        return true;
      }
    }
    return false;
  }

  claimPung(socketId) {
    if (!this.canClaim(socketId, 'pung')) {
      return { success: false, error: 'Cannot claim pung' };
    }

    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile)).slice(0, 2);

    // Remove from hand
    for (const m of matching) {
      player.hand = player.hand.filter(t => t.id !== m.id);
    }

    // Create meld
    const meld = {
      type: 'pung',
      tiles: [...matching, tile],
      exposed: true
    };
    player.exposed.push(meld);

    // Clear discard
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();

    // Set turn to this player
    this.currentTurn = this.playerOrder.indexOf(socketId);

    return { success: true, meld };
  }

  claimKong(socketId) {
    if (!this.canClaim(socketId, 'kong')) {
      return { success: false, error: 'Cannot claim kong' };
    }

    const player = this.players[socketId];
    const tile = this.lastDiscard;
    const matching = player.hand.filter(t => tilesMatch(t, tile)).slice(0, 3);

    for (const m of matching) {
      player.hand = player.hand.filter(t => t.id !== m.id);
    }

    const meld = {
      type: 'kong',
      tiles: [...matching, tile],
      exposed: true
    };
    player.exposed.push(meld);

    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();

    this.currentTurn = this.playerOrder.indexOf(socketId);

    // Draw replacement
    if (this.wall.length > 0) {
      const replacement = this.wall.pop();
      player.hand.push(replacement);
      if (replacement.type === 'bonus') {
        this.replaceFlowers(socketId);
      }
    }

    return { success: true, meld };
  }

  claimChow(socketId, tileIds) {
    if (!this.canClaim(socketId, 'chow')) {
      return { success: false, error: 'Cannot claim chow' };
    }

    const player = this.players[socketId];
    const tile = this.lastDiscard;

    // Get the two tiles from hand
    const handTiles = tileIds.map(id => player.hand.find(t => t.id === id)).filter(Boolean);
    if (handTiles.length !== 2) {
      return { success: false, error: 'Invalid tiles for chow' };
    }

    // Verify it forms a sequence
    const all = [...handTiles, tile].sort((a, b) => a.value - b.value);
    if (all[0].suit !== all[1].suit || all[1].suit !== all[2].suit) {
      return { success: false, error: 'Tiles must be same suit' };
    }
    if (all[1].value !== all[0].value + 1 || all[2].value !== all[1].value + 1) {
      return { success: false, error: 'Tiles must be consecutive' };
    }

    // Remove from hand
    for (const t of handTiles) {
      player.hand = player.hand.filter(h => h.id !== t.id);
    }

    const meld = {
      type: 'chow',
      tiles: all,
      exposed: true
    };
    player.exposed.push(meld);

    this.lastDiscard = null;
    this.lastDiscardPlayer = null;
    this.discardPile.pop();

    this.currentTurn = this.playerOrder.indexOf(socketId);

    return { success: true, meld };
  }

  declareConcealedKong(socketId, tileId) {
    if (this.getCurrentPlayer() !== socketId) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.players[socketId];
    const tile = player.hand.find(t => t.id === tileId);
    if (!tile) return { success: false, error: 'Tile not in hand' };

    const matching = player.hand.filter(t => tilesMatch(t, tile));
    if (matching.length < 4) {
      return { success: false, error: 'Need 4 matching tiles for kong' };
    }

    // Remove all 4 from hand
    const kongTiles = matching.slice(0, 4);
    for (const t of kongTiles) {
      player.hand = player.hand.filter(h => h.id !== t.id);
    }

    const meld = {
      type: 'kong',
      tiles: kongTiles,
      exposed: false,
      concealed: true
    };
    player.exposed.push(meld);

    // Draw replacement
    if (this.wall.length > 0) {
      const replacement = this.wall.pop();
      player.hand.push(replacement);
      if (replacement.type === 'bonus') {
        this.replaceFlowers(socketId);
      }
    }

    return { success: true, meld };
  }

  nextTurn() {
    if (this.wall.length === 0) {
      this.phase = 'ended';
      return { success: true, drawn: true };
    }

    this.currentTurn = (this.currentTurn + 1) % 4;
    this.lastDiscard = null;
    this.lastDiscardPlayer = null;

    const socketId = this.getCurrentPlayer();
    const tile = this.dealTile(socketId);

    if (tile && tile.type === 'bonus') {
      this.replaceFlowers(socketId);
    }

    return { success: true, drawn: false };
  }

  isWinningHand(hand, exposed) {
    // Need: 4 melds + 1 pair = 14 tiles
    const totalMelds = exposed.length;
    const handTiles = [...hand];
    const neededMelds = 4 - totalMelds;

    return this.checkWinningCombination(handTiles, neededMelds);
  }

  checkWinningCombination(tiles, neededMelds) {
    if (tiles.length === 0 && neededMelds === 0) return false;
    if (tiles.length === 2 && neededMelds === 0) {
      return tilesMatch(tiles[0], tiles[1]); // Pair
    }
    if (tiles.length < 2) return false;

    const sorted = sortHand(tiles);

    // Try each tile as start of pair
    for (let i = 0; i < sorted.length - 1; i++) {
      if (tilesMatch(sorted[i], sorted[i + 1])) {
        const remaining = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
        if (this.canFormMelds(remaining, neededMelds)) {
          return true;
        }
      }
    }

    return false;
  }

  canFormMelds(tiles, count) {
    if (count === 0) return tiles.length === 0;
    if (tiles.length < 3) return false;

    const sorted = sortHand(tiles);

    // Try pung
    if (sorted.length >= 3 && tilesMatch(sorted[0], sorted[1]) && tilesMatch(sorted[1], sorted[2])) {
      const remaining = sorted.slice(3);
      if (this.canFormMelds(remaining, count - 1)) return true;
    }

    // Try chow
    if (sorted[0].type === 'suited') {
      const suit = sorted[0].suit;
      const val = sorted[0].value;
      const second = sorted.find(t => t.suit === suit && t.value === val + 1);
      const third = sorted.find(t => t.suit === suit && t.value === val + 2);

      if (second && third) {
        const remaining = sorted.filter(t => t.id !== sorted[0].id && t.id !== second.id && t.id !== third.id);
        if (this.canFormMelds(remaining, count - 1)) return true;
      }
    }

    return false;
  }

  declareMahjong(socketId, fromDiscard) {
    const player = this.players[socketId];
    let hand = [...player.hand];

    if (fromDiscard && this.lastDiscard) {
      hand.push(this.lastDiscard);
    }

    if (!this.isWinningHand(hand, player.exposed)) {
      return { success: false, error: 'Not a winning hand' };
    }

    const score = this.calculateScore(player, fromDiscard);
    player.score = score;
    this.phase = 'ended';

    return {
      success: true,
      score,
      hand: player.hand,
      exposed: player.exposed,
      flowers: player.flowers
    };
  }

  calculateScore(player, fromDiscard) {
    let score = 1; // Base score

    // Flowers/Seasons
    score += player.flowers.length;

    // All concealed
    if (player.exposed.every(m => m.concealed)) {
      score += 1;
    }

    // Self-draw
    if (!fromDiscard) {
      score += 1;
    }

    // Kong bonus
    const kongs = player.exposed.filter(m => m.type === 'kong').length;
    score += kongs * 2;

    // All pungs
    if (player.exposed.every(m => m.type === 'pung' || m.type === 'kong')) {
      score += 3;
    }

    return Math.pow(2, score); // Exponential scoring
  }

  getPublicState() {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      currentTurn: this.currentTurn,
      currentPlayer: this.getCurrentPlayer(),
      roundWind: this.roundWind,
      wallCount: this.wall.length,
      discardPile: this.discardPile.slice(-10),
      lastDiscard: this.lastDiscard,
      players: this.playerOrder.map(sid => {
        const p = this.players[sid];
        return {
          oderId: p.oderId,
          displayName: p.displayName,
          avatar: p.avatar,
          seatWind: p.seatWind,
          handCount: p.hand.length,
          exposed: p.exposed,
          flowers: p.flowers,
          discardCount: p.discards.length
        };
      })
    };
  }

  getStateForPlayer(socketId) {
    const state = this.getPublicState();
    const player = this.players[socketId];

    if (player) {
      state.myHand = sortHand(player.hand);
      state.myExposed = player.exposed;
      state.myFlowers = player.flowers;
      state.mySeatWind = player.seatWind;
      state.isMyTurn = this.getCurrentPlayer() === socketId;

      // Check available actions
      if (this.lastDiscard && this.lastDiscardPlayer !== socketId) {
        state.canPung = this.canClaim(socketId, 'pung');
        state.canKong = this.canClaim(socketId, 'kong');
        state.canChow = this.canClaim(socketId, 'chow');
        state.canMahjong = this.canClaim(socketId, 'mahjong');
      }
    }

    return state;
  }

  getPlayersInfo() {
    return this.playerOrder.map(sid => {
      const p = this.players[sid];
      return {
        oderId: p.oderId,
        displayName: p.displayName,
        avatar: p.avatar,
        seatWind: p.seatWind,
        isReady: p.isReady
      };
    });
  }
}

export { MahjongGame, createTileSet, TILE_CHARS, SUITS, WINDS, DRAGONS };
