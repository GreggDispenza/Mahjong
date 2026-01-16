// Database module using Supabase
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lexgvescxcmzwfympppf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxleGd2ZXNjeGNtendmeW1wcHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NDQ2NTIsImV4cCI6MjA4NDEyMDY1Mn0.9AvkykuUSlesYmS458CaOImMpBid-i3iMrmGSdJYmAI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

class MahjongDB {
  async init() {
    console.log('✅ Supabase database connected');
    return true;
  }

  // User methods
  async createUser(username, password, displayName) {
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      
      const { data: user, error } = await supabase
        .from('users')
        .insert({ username, password_hash: passwordHash, display_name: displayName })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') return { success: false, error: 'Username already exists' };
        throw error;
      }

      // Create stats record
      await supabase.from('player_stats').insert({ user_id: user.id });

      return { success: true, userId: user.id };
    } catch (err) {
      console.error('createUser error:', err);
      return { success: false, error: 'Registration failed' };
    }
  }

  async authenticateUser(username, password) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

      if (error || !user) return { success: false, error: 'User not found' };

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return { success: false, error: 'Invalid password' };

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          avatar: user.avatar
        }
      };
    } catch (err) {
      console.error('authenticateUser error:', err);
      return { success: false, error: 'Login failed' };
    }
  }

  async getUserById(id) {
    const { data } = await supabase
      .from('users')
      .select('id, username, display_name, avatar, created_at')
      .eq('id', id)
      .single();
    
    if (!data) return null;
    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      avatar: data.avatar,
      createdAt: data.created_at
    };
  }

  async setUserOnline(userId, isOnline) {
    await supabase
      .from('users')
      .update({ is_online: isOnline })
      .eq('id', userId);
  }

  async getOnlinePlayers() {
    const { data } = await supabase
      .from('users')
      .select('id, display_name, avatar')
      .eq('is_online', true);
    
    return (data || []).map(u => ({
      id: u.id,
      displayName: u.display_name,
      avatar: u.avatar
    }));
  }

  // Stats methods
  async getPlayerStats(userId) {
    const { data } = await supabase
      .from('player_stats')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (!data) return null;
    return {
      gamesPlayed: data.games_played,
      gamesWon: data.games_won,
      totalScore: data.total_score,
      highestScore: data.highest_score,
      winStreak: data.win_streak,
      currentStreak: data.current_streak
    };
  }

  async updatePlayerStats(userId, won, score, isMahjong) {
    const stats = await this.getPlayerStats(userId);
    if (!stats) return;

    const updates = {
      games_played: stats.gamesPlayed + 1,
      total_score: stats.totalScore + score,
      highest_score: Math.max(stats.highestScore, score)
    };

    if (won) {
      updates.games_won = stats.gamesWon + 1;
      updates.current_streak = stats.currentStreak + 1;
      updates.win_streak = Math.max(stats.winStreak, updates.current_streak);
    } else {
      updates.current_streak = 0;
    }

    await supabase
      .from('player_stats')
      .update(updates)
      .eq('user_id', userId);
  }

  // Leaderboard
  async getLeaderboard(limit = 50, sortBy = 'total_score') {
    const column = {
      'total_score': 'total_score',
      'games_won': 'games_won',
      'win_streak': 'win_streak',
      'games_played': 'games_played'
    }[sortBy] || 'total_score';

    const { data } = await supabase
      .from('player_stats')
      .select('user_id, games_played, games_won, total_score, win_streak')
      .order(column, { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return [];

    // Get user details
    const userIds = data.map(s => s.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, avatar')
      .in('id', userIds);

    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u; });

    return data.map(s => ({
      user_id: s.user_id,
      display_name: userMap[s.user_id]?.display_name || 'Unknown',
      avatar: userMap[s.user_id]?.avatar || 'default',
      games_played: s.games_played,
      games_won: s.games_won,
      total_score: s.total_score,
      win_streak: s.win_streak
    }));
  }

  // Game methods
  async createGame(roomCode) {
    const { data, error } = await supabase
      .from('games')
      .insert({ room_code: roomCode })
      .select()
      .single();
    
    return data?.id || null;
  }

  async endGame(gameId, winnerId) {
    await supabase
      .from('games')
      .update({ ended_at: new Date().toISOString(), winner_id: winnerId, status: 'finished' })
      .eq('id', gameId);
  }

  async addGameParticipant(gameId, userId, seatWind, score, isWinner) {
    await supabase
      .from('game_participants')
      .insert({ game_id: gameId, user_id: userId, seat_wind: seatWind, final_score: score, is_winner: isWinner });
  }

  async getPlayerHistory(userId, limit = 50) {
    const { data } = await supabase
      .from('game_participants')
      .select('game_id, seat_wind, final_score, is_winner, games(room_code, started_at, ended_at)')
      .eq('user_id', userId)
      .order('game_id', { ascending: false })
      .limit(limit);

    return (data || []).map(p => ({
      gameId: p.game_id,
      roomCode: p.games?.room_code,
      seatWind: p.seat_wind,
      score: p.final_score,
      isWinner: p.is_winner,
      startedAt: p.games?.started_at,
      endedAt: p.games?.ended_at
    }));
  }

  close() {
    // Supabase client doesn't need explicit close
  }
}

export default MahjongDB;
