// Mahjong Game Logic

class MahjongGame {
    constructor(players) {
        if (players.length !== 4) {
            throw new Error('Mahjong requires exactly 4 players');
        }

        // Ensure all players have required fields
        this.players = players.map((player, index) => {
            if (!player.id || !player.username) {
                throw new Error('Invalid player object: missing id or username');
            }
            
            const displayName = player.displayName || player.display_name || player.username;
            
            return {
                id: player.id,
                username: player.username,
                displayName: displayName,
                isAI: player.isAI || false,
                wind: ['East', 'South', 'West', 'North'][index],
                hand: [],
                melds: [],
                score: 1000,
                isWinner: false
            };
        });

        this.deck = this.createDeck();
        this.shuffleDeck();
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.claimWindow = null;
        this.gameOver = false;
        this.lastDiscard = null;

        this.dealInitialTiles();
    }

    createDeck() {
        const tiles = [];
        
        // Characters (萬) 1-9, 4 of each
        for (let i = 1; i <= 9; i++) {
            for (let j = 0; j < 4; j++) {
                tiles.push(`${i}m`);
            }
        }
        
        // Dots (筒) 1-9, 4 of each
        for (let i = 1; i <= 9; i++) {
            for (let j = 0; j < 4; j++) {
                tiles.push(`${i}p`);
            }
        }
        
        // Bamboo (條) 1-9, 4 of each
        for (let i = 1; i <= 9; i++) {
            for (let j = 0; j < 4; j++) {
                tiles.push(`${i}s`);
            }
        }
        
        // Winds (風) 1-4 = East, South, West, North
        for (let i = 1; i <= 4; i++) {
            for (let j = 0; j < 4; j++) {
                tiles.push(`${i}z`);
            }
        }
        
        // Dragons (三元) 5-7 = Red, Green, White
        for (let i = 5; i <= 7; i++) {
            for (let j = 0; j < 4; j++) {
                tiles.push(`${i}z`);
            }
        }
        
        return tiles;
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealInitialTiles() {
        // Deal 13 tiles to each player
        for (let i = 0; i < 13; i++) {
            for (let player of this.players) {
                player.hand.push(this.deck.pop());
            }
        }
        
        // Sort hands
        this.players.forEach(player => {
            player.hand.sort();
        });
    }

    drawTile() {
        if (this.deck.length === 0) {
            this.gameOver = true;
            return null;
        }
        return this.deck.pop();
    }

    discardTile(tileIndex) {
        const currentPlayer = this.players[this.currentPlayerIndex];
        
        if (tileIndex < 0 || tileIndex >= currentPlayer.hand.length) {
            return { success: false, error: 'Invalid tile index' };
        }

        const tile = currentPlayer.hand.splice(tileIndex, 1)[0];
        this.discardPile.push(tile);
        this.lastDiscard = tile;

        // Check if other players can claim
        this.checkClaims(tile);

        if (!this.claimWindow) {
            this.nextTurn();
        }

        return { success: true };
    }

    checkClaims(tile) {
        const validClaims = {};
        
        this.players.forEach((player, index) => {
            if (index === this.currentPlayerIndex) return;

            validClaims[index] = {
                canPung: this.canPung(player, tile),
                canKong: this.canKong(player, tile),
                canChow: this.canChow(player, tile) && this.isNextPlayer(index),
                canMahjong: this.canWin(player, tile)
            };
        });

        const hasValidClaims = Object.values(validClaims).some(claims => 
            claims.canPung || claims.canKong || claims.canChow || claims.canMahjong
        );

        if (hasValidClaims) {
            this.claimWindow = {
                tile,
                validClaims,
                players: Object.keys(validClaims).map(Number).filter(i => 
                    validClaims[i].canPung || validClaims[i].canKong || 
                    validClaims[i].canChow || validClaims[i].canMahjong
                )
            };
        }
    }

    isNextPlayer(index) {
        return index === (this.currentPlayerIndex + 1) % 4;
    }

    canPung(player, tile) {
        return player.hand.filter(t => t === tile).length >= 2;
    }

    canKong(player, tile) {
        return player.hand.filter(t => t === tile).length >= 3;
    }

    canChow(player, tile) {
        // Simplified: check if player has adjacent tiles
        const num = parseInt(tile[0]);
        const suit = tile[1];
        
        if (isNaN(num)) return false;

        const hasLower = player.hand.includes(`${num - 1}${suit}`);
        const hasHigher = player.hand.includes(`${num + 1}${suit}`);
        
        return (hasLower && hasHigher) || 
               (hasLower && player.hand.includes(`${num - 2}${suit}`)) ||
               (hasHigher && player.hand.includes(`${num + 2}${suit}`));
    }

    canWin(player, tile) {
        // Simplified win check: 4 melds + 1 pair
        const testHand = [...player.hand, tile];
        return testHand.length >= 13 && this.hasValidPattern(testHand);
    }

    hasValidPattern(hand) {
        // Very simplified: check if hand has potential winning pattern
        const counts = {};
        hand.forEach(tile => {
            counts[tile] = (counts[tile] || 0) + 1;
        });

        const pairs = Object.values(counts).filter(c => c >= 2).length;
        const triples = Object.values(counts).filter(c => c >= 3).length;
        
        return pairs >= 1 && triples >= 3;
    }

    processClaim(claimType) {
        if (!this.claimWindow) {
            return { success: false, error: 'No claim window active' };
        }

        // Find first player who can make this claim
        const playerIndex = this.claimWindow.players.find(i => {
            const claims = this.claimWindow.validClaims[i];
            if (claimType === 'pung') return claims.canPung;
            if (claimType === 'kong') return claims.canKong;
            if (claimType === 'chow') return claims.canChow;
            return false;
        });

        if (playerIndex === undefined) {
            return { success: false, error: 'Invalid claim' };
        }

        const player = this.players[playerIndex];
        const tile = this.claimWindow.tile;

        // Remove tile from discard pile
        this.discardPile.pop();

        // Add meld to player
        if (claimType === 'pung') {
            const tiles = player.hand.filter(t => t === tile).slice(0, 2);
            tiles.forEach(t => player.hand.splice(player.hand.indexOf(t), 1));
            player.melds.push({ type: 'pung', tiles: [tile, ...tiles] });
        } else if (claimType === 'kong') {
            const tiles = player.hand.filter(t => t === tile).slice(0, 3);
            tiles.forEach(t => player.hand.splice(player.hand.indexOf(t), 1));
            player.melds.push({ type: 'kong', tiles: [tile, ...tiles] });
        } else if (claimType === 'chow') {
            // Simplified chow
            const num = parseInt(tile[0]);
            const suit = tile[1];
            const tiles = [`${num - 1}${suit}`, `${num + 1}${suit}`];
            tiles.forEach(t => {
                const idx = player.hand.indexOf(t);
                if (idx >= 0) player.hand.splice(idx, 1);
            });
            player.melds.push({ type: 'chow', tiles: [tile, ...tiles].sort() });
        }

        this.currentPlayerIndex = playerIndex;
        this.claimWindow = null;

        return { success: true };
    }

    declareMahjong() {
        const player = this.players[this.currentPlayerIndex];
        
        if (this.canWin(player, player.hand[player.hand.length - 1])) {
            player.isWinner = true;
            this.gameOver = true;
            player.score += 500;
        }
    }

    skipClaim() {
        this.claimWindow = null;
        this.nextTurn();
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % 4;
        
        // Draw tile for next player
        const tile = this.drawTile();
        if (tile) {
            this.players[this.currentPlayerIndex].hand.push(tile);
            this.players[this.currentPlayerIndex].hand.sort();
        }
    }

    getAIMove() {
        const player = this.players[this.currentPlayerIndex];
        
        if (!player.isAI) return null;

        // AI decision logic
        if (this.claimWindow) {
            const claims = this.claimWindow.validClaims[this.currentPlayerIndex];
            
            if (claims.canMahjong && Math.random() > 0.05) {
                return { type: 'claim', claimType: 'mahjong' };
            }
            if (claims.canKong && Math.random() > 0.2) {
                return { type: 'claim', claimType: 'kong' };
            }
            if (claims.canPung && Math.random() > 0.3) {
                return { type: 'claim', claimType: 'pung' };
            }
            if (claims.canChow && Math.random() > 0.6) {
                return { type: 'claim', claimType: 'chow' };
            }
            
            return { type: 'skip' };
        }

        // Discard strategy: discard first tile (simplified)
        const tileIndex = Math.floor(Math.random() * player.hand.length);
        return { type: 'discard', tileIndex };
    }

    getState() {
        return {
            players: this.players.map(p => ({
                id: p.id,
                username: p.username,
                displayName: p.displayName,
                isAI: p.isAI,
                wind: p.wind,
                hand: p.hand,
                melds: p.melds,
                score: p.score,
                isWinner: p.isWinner
            })),
            discardPile: this.discardPile,
            currentPlayerIndex: this.currentPlayerIndex,
            claimWindow: this.claimWindow,
            gameOver: this.gameOver,
            tilesLeft: this.deck.length
        };
    }
}

module.exports = MahjongGame;
