/**
 * ═══════════════════════════════════════════════════════════════════════
 * HKOS MAHJONG - DATABASE MODULE (Supabase)
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Handles all database operations with Supabase PostgreSQL
 */

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

// ═══════════════════════════════════════════════════════════════════════
// SUPABASE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('⚠️  WARNING: Supabase credentials not configured!');
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
    console.error('SUPABASE_URL:', SUPABASE_URL ? 'Set' : 'MISSING');
    console.error('SUPABASE_KEY:', SUPABASE_KEY ? 'Set' : 'MISSING');
    throw new Error('Supabase credentials are required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bcrypt salt rounds
const SALT_ROUNDS = 10;

// ═══════════════════════════════════════════════════════════════════════
// USER AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a new user
 * @param {string} username 
 * @param {string} password 
 * @returns {Promise<{success: boolean, userId?: number, username?: string, error?: string}>}
 */
async function createUser(username, password) {
    try {
        // Check if username already exists
        const { data: existing, error: checkError } = await supabase
            .from('users')
            .select('user_id')
            .eq('username', username)
            .single();
        
        if (existing) {
            return { 
                success: false, 
                error: 'Username already taken' 
            };
        }
        
        // Hash password
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert new user
        const { data, error } = await supabase
            .from('users')
            .insert([
                { 
                    username, 
                    password_hash,
                    created_at: new Date().toISOString()
                }
            ])
            .select('user_id, username')
            .single();
        
        if (error) {
            console.error('Create user error:', error);
            return { 
                success: false, 
                error: 'Failed to create user' 
            };
        }
        
        return {
            success: true,
            userId: data.user_id,
            username: data.username
        };
        
    } catch (error) {
        console.error('Create user exception:', error);
        return { 
            success: false, 
            error: 'Database error' 
        };
    }
}

/**
 * Verify user credentials
 * @param {string} username 
 * @param {string} password 
 * @returns {Promise<{success: boolean, userId?: number, username?: string, error?: string}>}
 */
async function verifyUser(username, password) {
    try {
        // Get user by username
        const { data, error } = await supabase
            .from('users')
            .select('user_id, username, password_hash')
            .eq('username', username)
            .single();
        
        if (error || !data) {
            return { 
                success: false, 
                error: 'Invalid username or password' 
            };
        }
        
        // Verify password
        const isValid = await bcrypt.compare(password, data.password_hash);
        
        if (!isValid) {
            return { 
                success: false, 
                error: 'Invalid username or password' 
            };
        }
        
        // Update last login
        await supabase
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('user_id', data.user_id);
        
        return {
            success: true,
            userId: data.user_id,
            username: data.username
        };
        
    } catch (error) {
        console.error('Verify user exception:', error);
        return { 
            success: false, 
            error: 'Database error' 
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// GAME STATISTICS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Update player statistics after a game
 * @param {number} userId 
 * @param {Object} stats - { gamesWon: 1, totalScore: 10 }
 * @returns {Promise<{success: boolean}>}
 */
async function updatePlayerStats(userId, stats) {
    try {
        const { gamesWon = 0, totalScore = 0 } = stats;
        
        // Get current stats
        const { data: current } = await supabase
            .from('users')
            .select('games_played, games_won, total_score')
            .eq('user_id', userId)
            .single();
        
        if (!current) {
            return { success: false, error: 'User not found' };
        }
        
        // Update stats
        const { error } = await supabase
            .from('users')
            .update({
                games_played: (current.games_played || 0) + 1,
                games_won: (current.games_won || 0) + gamesWon,
                total_score: (current.total_score || 0) + totalScore,
                last_login: new Date().toISOString()
            })
            .eq('user_id', userId);
        
        if (error) {
            console.error('Update stats error:', error);
            return { success: false };
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('Update stats exception:', error);
        return { success: false };
    }
}

/**
 * Get leaderboard
 * @param {number} limit - Number of top players to return
 * @returns {Promise<Array>}
 */
async function getLeaderboard(limit = 10) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('username, games_played, games_won, total_score')
            .gt('games_played', 0)
            .order('games_won', { ascending: false })
            .order('total_score', { ascending: false })
            .limit(limit);
        
        if (error) {
            console.error('Leaderboard error:', error);
            return [];
        }
        
        return data || [];
        
    } catch (error) {
        console.error('Leaderboard exception:', error);
        return [];
    }
}

/**
 * Get user stats
 * @param {number} userId 
 * @returns {Promise<Object|null>}
 */
async function getUserStats(userId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('username, games_played, games_won, total_score, created_at')
            .eq('user_id', userId)
            .single();
        
        if (error) {
            console.error('Get user stats error:', error);
            return null;
        }
        
        return data;
        
    } catch (error) {
        console.error('Get user stats exception:', error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// GAME STATE PERSISTENCE (Optional - for future use)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Save game state to database
 * @param {string} gameId 
 * @param {Object} gameData 
 * @returns {Promise<{success: boolean}>}
 */
async function saveGameState(gameId, gameData) {
    try {
        const { error } = await supabase
            .from('games')
            .upsert({
                game_id: gameId,
                prevailing_wind: gameData.prevailingWind,
                dealer_id: gameData.dealerId,
                live_wall: JSON.stringify(gameData.liveWall),
                dead_wall: JSON.stringify(gameData.deadWall),
                live_wall_pointer: gameData.livePointer || 0,
                dead_wall_pointer: gameData.deadPointer || 0,
                is_active: gameData.isActive,
                turn_count: gameData.turnCount || 0
            });
        
        if (error) {
            console.error('Save game error:', error);
            return { success: false };
        }
        
        return { success: true };
        
    } catch (error) {
        console.error('Save game exception:', error);
        return { success: false };
    }
}

/**
 * Load game state from database
 * @param {string} gameId 
 * @returns {Promise<Object|null>}
 */
async function loadGameState(gameId) {
    try {
        const { data, error } = await supabase
            .from('games')
            .select('*')
            .eq('game_id', gameId)
            .single();
        
        if (error || !data) {
            return null;
        }
        
        return {
            gameId: data.game_id,
            prevailingWind: data.prevailing_wind,
            dealerId: data.dealer_id,
            liveWall: JSON.parse(data.live_wall),
            deadWall: JSON.parse(data.dead_wall),
            livePointer: data.live_wall_pointer,
            deadPointer: data.dead_wall_pointer,
            isActive: data.is_active,
            turnCount: data.turn_count
        };
        
    } catch (error) {
        console.error('Load game exception:', error);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// DATABASE HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
async function testConnection() {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);
        
        if (error) {
            console.error('Database connection test failed:', error);
            return false;
        }
        
        console.log('✅ Database connection successful');
        return true;
        
    } catch (error) {
        console.error('Database connection test exception:', error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
    // Authentication
    createUser,
    verifyUser,
    
    // Statistics
    updatePlayerStats,
    getLeaderboard,
    getUserStats,
    
    // Game state (optional)
    saveGameState,
    loadGameState,
    
    // Utilities
    testConnection,
    
    // Raw client (for advanced queries)
    supabase
};

// Test connection on module load
testConnection();
