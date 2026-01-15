// Database module using LowDB (JSON file-based)
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'mahjong.json');

const defaultData = {
  users: [],
  playerStats: [],
  games: [],
  gameParticipants: [],
  friends: []
};

class MahjongDB {
  constructor() {
    this.db = null;
    this.ready = false;
  }

  async init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const adapter = new JSONFile(DB_PATH);
    this.db = new Low(adapter, defaultData);
    await this.db.read();
    this.db.data = { ...defaultData, ...this.db.data };
    await this.db.write();
    this.ready = true;
    console.log('✅ Database initialized');
  }

  generateId(collection) {
    const items = this.db.data[collection] || [];
    return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
  }

  async createUser(username, password, displayName, email = null) {
    const passwordHash = bcrypt.hashSync(password, 10);

    const existing = this.db.data.users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );
    if (existing) return { success: false, error: 'Username already taken' };

    const userId = this.generateId('users');
    this.db.data.users.push({
      id: userId,
      username: username.toLowerCase(),
      email,
      passwordHash,
      displayName,
      avatar: 'default',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      isOnline: false
    });

    this.db.data.playerStats.push({
      id: userId,
      userId: userId,
      gamesPlayed: 0,
      gamesWon: 0,
      totalScore: 0,
      highestScore: 0,
      mahjongCount: 0,
      winStreak: 0,
      bestStreak: 0
    });

    await this.db.write();
    return { success: true, userId };
  }

  async authenticateUser(username, password) {
    const user = this.db.data.users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );
    if (!user) return { success: false, error: 'User not found' };
    if (!bcrypt.compareSync(password, user.passwordHash)) {
      return { success: false, error: 'Invalid password' };
    }

    user.lastLogin = new Date().toISOString();
    await this.db.write();

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar
      }
    };
  }

  getUserById(userId) {
    const user = this.db.data.users.find(u => u.id === userId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      display_name: user.displayName,
      avatar: user.avatar,
      created_at: user.createdAt,
      last_login: user.lastLogin,
      is_online: user.isOnline
    };
  }

  async setUserOnline(userId, isOnline) {
    const user = this.db.data.users.find(u => u.id === userId);
    if (user) {
      user.isOnline = isOnline;
      await this.db.write();
    }
  }

  async updateProfile(userId, updates) {
    const user = this.db.data.users.find(u => u.id === userId);
    if (!user) return { success: false, error: 'User not found' };
    if (updates.display_name) user.displayName = updates.display_name;
    if (updates.avatar) user.avatar = updates.avatar;
    await this.db.write();
    return { success: true };
  }

  getPlayerStats(userId) {
    const stats = this.db.data.playerStats.find(s => s.userId === userId);
    const user = this.db.data.users.find(u => u.id === userId);
    if (!stats || !user) return null;

    return {
      user_id: stats.userId,
      display_name: user.displayName,
      avatar: user.avatar,
      games_played: stats.gamesPlayed,
      games_won: stats.gamesWon,
      total_score: stats.totalScore,
      highest_score: stats.highestScore,
      mahjong_count: stats.mahjongCount,
      win_streak: stats.winStreak,
      best_streak: stats.bestStreak
    };
  }

  async updatePlayerStats(userId, won, score, isMahjong) {
    const stats = this.db.data.playerStats.find(s => s.userId === userId);
    if (!stats) return;

    stats.gamesPlayed += 1;
    if (won) stats.gamesWon += 1;
    stats.totalScore += score;
    stats.highestScore = Math.max(stats.highestScore, score);
    if (isMahjong) stats.mahjongCount += 1;
    stats.winStreak = won ? stats.winStreak + 1 : 0;
    stats.bestStreak = Math.max(stats.bestStreak, stats.winStreak);

    await this.db.write();
  }

  getLeaderboard(limit = 20, sortBy = 'total_score') {
    const sortMap = {
      'total_score': 'totalScore',
      'games_won': 'gamesWon',
      'mahjong_count': 'mahjongCount',
      'win_streak': 'bestStreak'
    };
    const field = sortMap[sortBy] || 'totalScore';

    return this.db.data.playerStats
      .filter(s => s.gamesPlayed > 0)
      .map(s => {
        const user = this.db.data.users.find(u => u.id === s.userId);
        if (!user) return null;
        return {
          id: user.id,
          username: user.username,
          display_name: user.displayName,
          avatar: user.avatar,
          is_online: user.isOnline,
          games_played: s.gamesPlayed,
          games_won: s.gamesWon,
          total_score: s.totalScore,
          highest_score: s.highestScore,
          mahjong_count: s.mahjongCount,
          best_streak: s.bestStreak,
          win_rate: s.gamesPlayed > 0 ? Math.round((s.gamesWon / s.gamesPlayed) * 1000) / 10 : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => b[field.replace(/([A-Z])/g, '_$1').toLowerCase()] - a[field.replace(/([A-Z])/g, '_$1').toLowerCase()])
      .slice(0, limit);
  }

  async createGame(roomCode) {
    const gameId = this.generateId('games');
    this.db.data.games.push({
      id: gameId,
      roomCode,
      startedAt: new Date().toISOString(),
      endedAt: null,
      winnerId: null
    });
    await this.db.write();
    return gameId;
  }

  async endGame(gameId, winnerId) {
    const game = this.db.data.games.find(g => g.id === gameId);
    if (game) {
      game.endedAt = new Date().toISOString();
      game.winnerId = winnerId;
      await this.db.write();
    }
  }

  async addGameParticipant(gameId, oderId, seatWind, finalScore, isWinner) {
    this.db.data.gameParticipants.push({
      id: this.generateId('gameParticipants'),
      gameId,
      oderId,
      seatWind,
      finalScore,
      isWinner
    });
    await this.db.write();
  }

  getPlayerHistory(userId, limit = 20) {
    return this.db.data.gameParticipants
      .filter(p => p.oderId === userId)
      .map(p => {
        const game = this.db.data.games.find(g => g.id === p.gameId);
        const winner = game?.winnerId ? this.db.data.users.find(u => u.id === game.winnerId) : null;
        return {
          room_code: game?.roomCode,
          started_at: game?.startedAt,
          ended_at: game?.endedAt,
          seat_wind: p.seatWind,
          final_score: p.finalScore,
          is_winner: p.isWinner,
          winner_name: winner?.displayName
        };
      })
      .reverse()
      .slice(0, limit);
  }

  getOnlinePlayers() {
    return this.db.data.users
      .filter(u => u.isOnline)
      .map(u => ({
        id: u.id,
        username: u.username,
        display_name: u.displayName,
        avatar: u.avatar
      }));
  }

  close() {}
}

export default MahjongDB;
