/**
 * ═══════════════════════════════════════════════════════════════
 * HKOS GAME STATE MANAGER
 * Orchestrates multiplayer game flow with 100% HKOS compliance
 * ═══════════════════════════════════════════════════════════════
 */

const HKOSEngine = require('./HKOSEngine');
const config = require('./hkmj-config.json');

class HKOSGame {
    constructor(gameId, players) {
        this.gameId = gameId;
        this.engine = new HKOSEngine(config);
        
        // Game state initialization
        this.state = 'WAITING'; // WAITING, DEALING, PLAYING, CLAIMING, ENDED
        this.prevailingWind = 'E'; // Changes each round
        this.dealerPosition = 0; // Rotates
        this.currentPlayer = 0;
        this.currentRound = 1;
        this.consecutiveDraws = 0;
        
        // Wall management
        this.liveWall = [];
        this.deadWall = [];
        this.drawPointer = 0;
        
        // Players
        this.players = players.map((p, index) => ({
            id: p.id,
            name: p.name,
            isAI: p.isAI || false,
            wind: ['E', 'S', 'W', 'N'][index],
            position: index,
            concealed: [],
            exposed: [],
            discards: [],
            score: 0,
            isFuriten: false,
            furitenTile: null,
            lastDraw: null
        }));
        
        // Claim management
        this.pendingClaims = [];
        this.lastDiscard = null;
        this.lastDiscarder = null;
        
        // Audit trail (Anti-Fraud)
        this.moveHistory = [];
        this.discardHistory = [];
    }

    // ═══════════════════════════════════════════════════════════
    // GAME INITIALIZATION
    // ═══════════════════════════════════════════════════════════

    /**
     * Starts a new game round
     */
    startGame() {
        // Create and shuffle tile set
        const tiles = this.engine.createTileSet();
        
        // Split into live and dead walls
        const walls = this.engine.splitWall(tiles);
        this.liveWall = walls.liveWall;
        this.deadWall = walls.deadWall;
        this.drawPointer = 0;
        
        // Deal 13 tiles to each player
        this.dealTiles();
        
        // Set game state
        this.state = 'PLAYING';
        this.currentPlayer = this.dealerPosition;
        
        // Dealer draws 14th tile to start
        const dealerDraws = this.drawFromLiveWall();
        if (dealerDraws.success) {
            this.players[this.dealerPosition].lastDraw = dealerDraws.tile;
        }
        
        // Log game start
        this.logMove({
            type: 'GAME_START',
            round: this.currentRound,
            prevailingWind: this.prevailingWind,
            dealer: this.dealerPosition,
            timestamp: Date.now()
        });
        
        return {
            success: true,
            gameState: this.getPublicGameState()
        };
    }

    /**
     * Deals 13 tiles to each player
     */
    dealTiles() {
        for (let i = 0; i < 13; i++) {
            for (let player of this.players) {
                if (this.liveWall.length > 0) {
                    const tile = this.liveWall.shift();
                    player.concealed.push(tile);
                    this.drawPointer++;
                }
            }
        }
        
        // Sort each player's hand
        this.players.forEach(p => {
            p.concealed.sort();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // TURN EXECUTION
    // ═══════════════════════════════════════════════════════════

    /**
     * Executes current player's turn start
     * @returns {Object} Turn start result
     */
    executeTurnStart() {
        if (this.state !== 'PLAYING') {
            return { success: false, reason: 'Game not in playing state' };
        }
        
        const player = this.players[this.currentPlayer];
        
        // Execute turn logic via engine
        const turnResult = this.engine.turnStart({
            liveWall: this.liveWall,
            deadWall: this.deadWall,
            currentPlayer: this.currentPlayer,
            prevailingWind: this.prevailingWind
        });
        
        if (turnResult.action === 'EXHAUSTIVE_DRAW') {
            return this.handleExhaustiveDraw();
        }
        
        // Draw successful
        player.concealed.push(turnResult.tile);
        player.lastDraw = turnResult.tile;
        player.concealed.sort();
        
        this.logMove({
            type: 'DRAW',
            player: this.currentPlayer,
            tile: turnResult.tile,
            source: 'LIVE_WALL',
            timestamp: Date.now()
        });
        
        // Enter action phase
        const availableActions = this.engine.actionPhase(player, {
            liveWall: this.liveWall,
            deadWall: this.deadWall,
            prevailingWind: this.prevailingWind
        }, turnResult.tile);
        
        return {
            success: true,
            drawnTile: turnResult.tile,
            availableActions: availableActions,
            gameState: this.getPublicGameState()
        };
    }

    /**
     * Player discards a tile
     * @param {number} playerPosition - Position of player
     * @param {string} tile - Tile to discard
     * @returns {Object} Discard result
     */
    executeDiscard(playerPosition, tile) {
        if (this.currentPlayer !== playerPosition) {
            return { success: false, reason: 'Not your turn' };
        }
        
        const player = this.players[playerPosition];
        const tileIndex = player.concealed.indexOf(tile);
        
        if (tileIndex === -1) {
            return { success: false, reason: 'Tile not in hand' };
        }
        
        // Remove tile from hand
        player.concealed.splice(tileIndex, 1);
        player.discards.push(tile);
        
        // Reset furiten after own discard
        this.engine.resetFuriten(player);
        
        // Store discard info for claims
        this.lastDiscard = tile;
        this.lastDiscarder = playerPosition;
        
        // Log move
        this.logMove({
            type: 'DISCARD',
            player: playerPosition,
            tile: tile,
            timestamp: Date.now()
        });
        
        this.discardHistory.push({
            player: playerPosition,
            tile: tile,
            turn: this.moveHistory.length
        });
        
        // Enter claim phase
        this.state = 'CLAIMING';
        this.pendingClaims = [];
        
        return {
            success: true,
            tile: tile,
            gameState: this.getPublicGameState()
        };
    }

    /**
     * Player declares a kong
     * @param {number} playerPosition - Position of player
     * @param {string} kongType - 'CONCEALED' or 'ADDED'
     * @param {string} tile - Tile for kong
     * @returns {Object} Kong result
     */
    executeKong(playerPosition, kongType, tile) {
        if (this.currentPlayer !== playerPosition) {
            return { success: false, reason: 'Not your turn' };
        }
        
        const player = this.players[playerPosition];
        
        // Handle kong via engine
        const kongResult = this.engine.handleKong({
            deadWall: this.deadWall,
            liveWall: this.liveWall
        }, kongType);
        
        if (!kongResult.success) {
            if (kongResult.action === 'EXHAUSTIVE_DRAW') {
                return this.handleExhaustiveDraw();
            }
            return { success: false, reason: kongResult.reason };
        }
        
        // Remove tiles from hand and create meld
        if (kongType === 'CONCEALED') {
            // Remove 4 matching tiles
            for (let i = 0; i < 4; i++) {
                const idx = player.concealed.indexOf(tile);
                if (idx !== -1) player.concealed.splice(idx, 1);
            }
            player.exposed.push({
                type: 'KONG_CONCEALED',
                tiles: [tile, tile, tile, tile]
            });
        } else if (kongType === 'ADDED') {
            // Find existing pung and upgrade to kong
            const pungIndex = player.exposed.findIndex(m => 
                m.type === 'PUNG' && m.tiles[0] === tile
            );
            if (pungIndex === -1) {
                return { success: false, reason: 'No pung found to upgrade' };
            }
            player.exposed[pungIndex] = {
                type: 'KONG_ADDED',
                tiles: [tile, tile, tile, tile]
            };
            // Remove 1 tile from hand
            const idx = player.concealed.indexOf(tile);
            if (idx !== -1) player.concealed.splice(idx, 1);
        }
        
        // Draw replacement tile
        player.concealed.push(kongResult.tile);
        player.lastDraw = kongResult.tile;
        player.concealed.sort();
        
        // Log move
        this.logMove({
            type: 'KONG',
            player: playerPosition,
            kongType: kongType,
            tile: tile,
            replacement: kongResult.tile,
            timestamp: Date.now()
        });
        
        // Check if replacement tile allows win
        const winCheck = this.engine.evaluateWinCondition(
            player,
            kongResult.tile,
            { prevailingWind: this.prevailingWind },
            true
        );
        
        return {
            success: true,
            replacementTile: kongResult.tile,
            canWin: winCheck.valid,
            winDetails: winCheck.valid ? winCheck : null,
            gameState: this.getPublicGameState()
        };
    }

    // ═══════════════════════════════════════════════════════════
    // CLAIM MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /**
     * Player submits a claim on discarded tile
     * @param {number} playerPosition - Position of claiming player
     * @param {string} claimType - 'WIN_HU', 'PUNG', 'KONG_EXPOSED', 'CHOW'
     * @param {Object} details - Additional claim details
     * @returns {Object} Claim submission result
     */
    submitClaim(playerPosition, claimType, details = {}) {
        if (this.state !== 'CLAIMING') {
            return { success: false, reason: 'No active claim window' };
        }
        
        const player = this.players[playerPosition];
        
        // Create claim object
        const claim = {
            type: claimType,
            playerPosition: playerPosition,
            tile: this.lastDiscard,
            ...details
        };
        
        // Validate claim
        const isValid = this.engine.validateClaim(claim, player, {
            currentPlayer: this.lastDiscarder,
            prevailingWind: this.prevailingWind
        });
        
        if (!isValid) {
            return { success: false, reason: 'Invalid claim' };
        }
        
        this.pendingClaims.push(claim);
        
        return { success: true };
    }

    /**
     * Resolves all pending claims and executes winner
     * @returns {Object} Resolution result
     */
    resolveClaims() {
        if (this.pendingClaims.length === 0) {
            // No claims, advance to next player
            this.state = 'PLAYING';
            this.currentPlayer = (this.currentPlayer + 1) % 4;
            return {
                success: true,
                result: 'NO_CLAIMS',
                nextPlayer: this.currentPlayer
            };
        }
        
        // Resolve using priority system
        const winningClaim = this.engine.resolveClaims(
            this.pendingClaims,
            this.lastDiscarder
        );
        
        if (!winningClaim) {
            return { success: false, reason: 'Claim resolution failed' };
        }
        
        // Execute the winning claim
        return this.executeClaim(winningClaim);
    }

    /**
     * Executes a claim (win, pung, kong, chow)
     * @param {Object} claim - The claim to execute
     * @returns {Object} Execution result
     */
    executeClaim(claim) {
        const player = this.players[claim.playerPosition];
        
        if (claim.type === 'WIN_HU') {
            return this.executeWin(claim.playerPosition, this.lastDiscard, false);
        }
        
        // Remove tile from discarder's discards
        const discarder = this.players[this.lastDiscarder];
        discarder.discards.pop();
        
        // Create meld
        if (claim.type === 'PUNG') {
            // Remove 2 matching tiles from hand
            for (let i = 0; i < 2; i++) {
                const idx = player.concealed.indexOf(this.lastDiscard);
                if (idx !== -1) player.concealed.splice(idx, 1);
            }
            player.exposed.push({
                type: 'PUNG',
                tiles: [this.lastDiscard, this.lastDiscard, this.lastDiscard],
                from: this.lastDiscarder
            });
        } else if (claim.type === 'KONG_EXPOSED') {
            // Remove 3 matching tiles from hand
            for (let i = 0; i < 3; i++) {
                const idx = player.concealed.indexOf(this.lastDiscard);
                if (idx !== -1) player.concealed.splice(idx, 1);
            }
            player.exposed.push({
                type: 'KONG_EXPOSED',
                tiles: [this.lastDiscard, this.lastDiscard, this.lastDiscard, this.lastDiscard],
                from: this.lastDiscarder
            });
            
            // Draw from dead wall
            const kongResult = this.engine.handleKong({
                deadWall: this.deadWall,
                liveWall: this.liveWall
            }, 'EXPOSED');
            
            if (kongResult.success) {
                player.concealed.push(kongResult.tile);
                player.lastDraw = kongResult.tile;
                player.concealed.sort();
            }
        } else if (claim.type === 'CHOW') {
            // Remove the other 2 tiles from sequence
            const sequence = claim.sequence || [];
            for (let seqTile of sequence) {
                if (seqTile !== this.lastDiscard) {
                    const idx = player.concealed.indexOf(seqTile);
                    if (idx !== -1) player.concealed.splice(idx, 1);
                }
            }
            player.exposed.push({
                type: 'CHOW',
                tiles: sequence,
                from: this.lastDiscarder
            });
        }
        
        // Log claim
        this.logMove({
            type: 'CLAIM',
            claimType: claim.type,
            player: claim.playerPosition,
            tile: this.lastDiscard,
            from: this.lastDiscarder,
            timestamp: Date.now()
        });
        
        // Current player becomes claimer
        this.currentPlayer = claim.playerPosition;
        this.state = 'PLAYING';
        
        return {
            success: true,
            claim: claim,
            gameState: this.getPublicGameState()
        };
    }

    // ═══════════════════════════════════════════════════════════
    // WIN HANDLING
    // ═══════════════════════════════════════════════════════════

    /**
     * Declares a win (hu)
     * @param {number} playerPosition - Winning player
     * @param {string} winningTile - The tile that completes the hand
     * @param {boolean} isSelfDraw - Whether this is self-draw
     * @returns {Object} Win result with settlement
     */
    executeWin(playerPosition, winningTile, isSelfDraw) {
        const player = this.players[playerPosition];
        
        // Evaluate win condition
        const winCheck = this.engine.evaluateWinCondition(
            player,
            winningTile,
            { prevailingWind: this.prevailingWind },
            isSelfDraw
        );
        
        if (!winCheck.valid) {
            return { success: false, reason: winCheck.reason };
        }
        
        // Calculate settlement
        const losers = this.players.filter((p, i) => i !== playerPosition);
        if (!isSelfDraw) {
            const discarderIndex = losers.findIndex(l => l.position === this.lastDiscarder);
            if (discarderIndex !== -1) {
                losers[discarderIndex].isDiscarder = true;
            }
        }
        
        const settlement = this.engine.calculateSettlement(
            player,
            losers,
            winCheck,
            { prevailingWind: this.prevailingWind }
        );
        
        // Update scores
        player.score += settlement.winnerGains;
        for (let [loserId, payment] of Object.entries(settlement.payments)) {
            const loser = this.players.find(p => p.id === loserId);
            if (loser) loser.score -= payment;
        }
        
        // Log win
        this.logMove({
            type: 'WIN',
            player: playerPosition,
            method: isSelfDraw ? 'SELF_DRAW' : 'DISCARD',
            tile: winningTile,
            faan: settlement.faan,
            points: settlement.points,
            settlement: settlement,
            timestamp: Date.now()
        });
        
        // End game
        this.state = 'ENDED';
        
        return {
            success: true,
            winner: player,
            winDetails: winCheck,
            settlement: settlement,
            gameState: this.getPublicGameState()
        };
    }

    /**
     * Handles exhaustive draw (wall depleted)
     * @returns {Object} Draw result
     */
    handleExhaustiveDraw() {
        this.state = 'ENDED';
        
        this.logMove({
            type: 'EXHAUSTIVE_DRAW',
            reason: 'Wall depleted',
            timestamp: Date.now()
        });
        
        return {
            success: true,
            result: 'DRAW',
            reason: 'Exhaustive draw - wall depleted',
            gameState: this.getPublicGameState()
        };
    }

    // ═══════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════

    /**
     * Draws tile from live wall with anti-leak protection
     * @returns {Object} {success, tile?, reason?}
     */
    drawFromLiveWall() {
        if (this.liveWall.length === 0) {
            return { success: false, reason: 'Live wall depleted' };
        }
        
        const tile = this.liveWall.shift();
        this.drawPointer++;
        
        return { success: true, tile: tile };
    }

    /**
     * Gets public game state (hides concealed info)
     * @returns {Object} Public game state
     */
    getPublicGameState() {
        return {
            gameId: this.gameId,
            state: this.state,
            round: this.currentRound,
            prevailingWind: this.prevailingWind,
            currentPlayer: this.currentPlayer,
            dealer: this.dealerPosition,
            liveWallRemaining: this.liveWall.length,
            deadWallRemaining: this.deadWall.length,
            lastDiscard: this.lastDiscard,
            lastDiscarder: this.lastDiscarder,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isAI: p.isAI,
                wind: p.wind,
                position: p.position,
                concealedCount: p.concealed.length,
                exposed: p.exposed,
                discards: p.discards,
                score: p.score,
                isFuriten: p.isFuriten
            }))
        };
    }

    /**
     * Gets private player state (for that player only)
     * @param {number} playerPosition - Position of player
     * @returns {Object} Private player state
     */
    getPrivatePlayerState(playerPosition) {
        const player = this.players[playerPosition];
        return {
            concealed: player.concealed,
            lastDraw: player.lastDraw,
            availableActions: this.state === 'PLAYING' && this.currentPlayer === playerPosition
                ? this.engine.actionPhase(player, {
                    liveWall: this.liveWall,
                    deadWall: this.deadWall,
                    prevailingWind: this.prevailingWind
                }, player.lastDraw)
                : []
        };
    }

    /**
     * Logs move to audit trail (Anti-Fraud)
     * @param {Object} move - Move details
     */
    logMove(move) {
        this.moveHistory.push({
            moveNumber: this.moveHistory.length + 1,
            ...move
        });
    }

    /**
     * Gets move history for AI learning
     * @returns {Array} Move history
     */
    getMoveHistory() {
        return this.moveHistory;
    }

    /**
     * Gets discard history for risk assessment
     * @returns {Array} Discard history
     */
    getDiscardHistory() {
        return this.discardHistory;
    }

    /**
     * Get AI move decision (simple AI that just discards first tile)
     * @param {Object} player - AI player object
     * @returns {Object} AI move decision
     */
    getAIMove(player) {
        if (!player || !player.isAI) {
            return null;
        }

        // Simple AI: just discard the first tile in hand
        // This ensures the game doesn't get stuck
        if (player.concealed && player.concealed.length > 0) {
            return {
                action: 'DISCARD',
                tileIndex: 0  // Always discard first tile
            };
        }

        return null;
    }
}

module.exports = HKOSGame;
