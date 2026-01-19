const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

// Create user
async function createUser(username, displayName, password) {
    const passwordHash = await bcrypt.hash(password, 10);
    
    if (!supabase) {
        throw new Error('Database not configured');
    }

    const { data, error } = await supabase
        .from('users')
        .insert([
            {
                username,
                display_name: displayName,
                password_hash: passwordHash,
                is_online: true
            }
        ])
        .select()
        .single();

    if (error) {
        if (error.code === '23505') { // Unique constraint violation
            throw new Error('Username already exists');
        }
        throw error;
    }

    // Create player stats
    await supabase
        .from('player_stats')
        .insert([{ user_id: data.id }]);

    return {
        id: data.id,
        username: data.username,
        display_name: data.display_name,
        displayName: data.display_name, // Add both formats for compatibility
        isOnline: data.is_online
    };
}

// Authenticate user
async function authenticateUser(username, password) {
    if (!supabase) {
        throw new Error('Database not configured');
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

    if (error || !data) {
        throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, data.password_hash);
    if (!validPassword) {
        throw new Error('Invalid credentials');
    }

    return {
        id: data.id,
        username: data.username,
        display_name: data.display_name,
        displayName: data.display_name, // Add both formats for compatibility
        isOnline: data.is_online
    };
}

// Get user by ID
async function getUser(userId) {
    if (!supabase) {
        throw new Error('Database not configured');
    }

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        throw error;
    }

    return {
        id: data.id,
        username: data.username,
        display_name: data.display_name,
        displayName: data.display_name, // Add both formats for compatibility
        isOnline: data.is_online
    };
}

// Set user online status
async function setUserOnline(userId, isOnline) {
    if (!supabase) {
        return;
    }

    await supabase
        .from('users')
        .update({ is_online: isOnline })
        .eq('id', userId);
}

// Get leaderboard
async function getLeaderboard(limit = 10) {
    if (!supabase) {
        return [];
    }

    const { data, error } = await supabase
        .from('player_stats')
        .select(`
            *,
            users!inner(display_name)
        `)
        .order('total_score', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Leaderboard error:', error);
        return [];
    }

    return data.map(row => ({
        display_name: row.users.display_name,
        games_played: row.games_played,
        games_won: row.games_won,
        total_score: row.total_score,
        highest_score: row.highest_score,
        win_streak: row.win_streak
    }));
}

// Create game record
async function createGame(roomCode, players) {
    if (!supabase) {
        return null;
    }

    const { data: game, error: gameError } = await supabase
        .from('games')
        .insert([{
            room_code: roomCode,
            status: 'active'
        }])
        .select()
        .single();

    if (gameError) {
        console.error('Create game error:', gameError);
        return null;
    }

    // Create participants
    const participants = players.map((player, index) => ({
        game_id: game.id,
        user_id: player.id,
        seat_wind: ['East', 'South', 'West', 'North'][index]
    }));

    await supabase
        .from('game_participants')
        .insert(participants);

    return game.id;
}

// End game
async function endGame(gameId, winnerId) {
    if (!supabase || !gameId) {
        return;
    }

    await supabase
        .from('games')
        .update({
            ended_at: new Date().toISOString(),
            winner_id: winnerId,
            status: 'completed'
        })
        .eq('id', gameId);
}

// Update player stats
async function updatePlayerStats(userId, score, isWinner) {
    if (!supabase) {
        return;
    }

    const { data: stats } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (!stats) {
        return;
    }

    const updates = {
        games_played: stats.games_played + 1,
        total_score: stats.total_score + score
    };

    if (isWinner) {
        updates.games_won = stats.games_won + 1;
        updates.win_streak = stats.win_streak + 1;
    } else {
        updates.win_streak = 0;
    }

    if (score > stats.highest_score) {
        updates.highest_score = score;
    }

    await supabase
        .from('player_stats')
        .update(updates)
        .eq('user_id', userId);
}

module.exports = {
    createUser,
    authenticateUser,
    getUser,
    setUserOnline,
    getLeaderboard,
    createGame,
    endGame,
    updatePlayerStats
};
