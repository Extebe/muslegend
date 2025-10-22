// server.js - Backend Sprint 2 - Game Logic complète + Sprints 3, 4, 5
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path'); // ← AJOUTÉ !

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/build')));

// ==================== CONFIGURATION ====================
const GAME_CONFIG = {
  MAX_PLAYERS: 4,
  RECONNECT_TIMEOUT: 60000,
  ACTION_TIMEOUT: 45000,
  DEFAULT_WIN_SCORE: 40,
  BET_VALUES: [1, 2, 3, 4, 5],
  MAX_KANTA: 3
};

// ==================== ÉTAT DU JEU ====================
const rooms = new Map();
const playerSockets = new Map();

class Room {
  constructor(roomId, creatorSocketId, creatorName, config = {}) {
    this.roomId = roomId;
    this.players = [];
    this.state = 'WAITING';
    this.teams = { A: [], B: [] };
    this.dealerPosition = 0;
    this.manoPosition = 0;
    this.currentPhase = null;
    this.deck = [];
    this.playerCards = {};
    this.musVotes = {};
    this.scores = { A: 0, B: 0 };
    this.winScore = config.winScore || GAME_CONFIG.DEFAULT_WIN_SCORE;
    this.phaseResults = {};
    this.currentPhaseIndex = 0;
    this.phases = ['GRAND', 'PETIT', 'PAIRES', 'JEU'];
    
    this.bettingState = {
      phase: null,
      currentBet: 0,
      totalStake: 0,
      bets: [],
      currentBettorIndex: 0,
      hordago: false,
      kantaCount: 0,
      passed: new Set()
    };
    
    this.history = [];
    this.roundHistory = [];
    this.gameStartTime = null;
    this.actionTimers = new Map();
    this.lastActivity = Date.now();
    
    this.addPlayer(creatorSocketId, creatorName);
  }

  addPlayer(socketId, name) {
    if (this.players.length >= GAME_CONFIG.MAX_PLAYERS) {
      return { success: false, error: 'Salle pleine' };
    }

    const player = {
      id: this.players.length,
      socketId,
      name,
      position: this.players.length,
      connected: true,
      lastSeen: Date.now(),
      stats: {
        roundsWon: 0,
        pointsScored: 0,
        betsWon: 0
      }
    };

    this.players.push(player);

    if (this.players.length === 4) {
      this.assignTeams();
      this.state = 'LOBBY';
    }

    return { success: true, player };
  }

  removePlayer(socketId) {
    const playerIndex = this.players.findIndex(p => p.socketId === socketId);
    if (playerIndex !== -1) {
      this.players.splice(playerIndex, 1);
      this.players.forEach((p, idx) => {
        p.position = idx;
        p.id = idx;
      });
      
      if (this.players.length < 4) {
        this.state = 'WAITING';
        this.teams = { A: [], B: [] };
      }
    }
  }

  assignTeams() {
    this.teams.A = [this.players[0], this.players[2]];
    this.teams.B = [this.players[1], this.players[3]];
  }

  createDeck() {
    const suits = ['♠', '♥', '♣', '♦'];
    const values = [
      { name: 'As', grandValue: 1, petitValue: 1, gameValue: 1 },
      { name: '2', grandValue: 2, petitValue: 2, gameValue: 2 },
      { name: '3', grandValue: 13, petitValue: 11, gameValue: 10 },
      { name: '4', grandValue: 3, petitValue: 3, gameValue: 4 },
      { name: '5', grandValue: 4, petitValue: 4, gameValue: 5 },
      { name: '6', grandValue: 5, petitValue: 5, gameValue: 6 },
      { name: '7', grandValue: 6, petitValue: 6, gameValue: 7 },
      { name: 'V', grandValue: 7, petitValue: 7, gameValue: 10 },
      { name: 'C', grandValue: 8, petitValue: 8, gameValue: 10 },
      { name: 'R', grandValue: 14, petitValue: 12, gameValue: 10 }
    ];

    this.deck = [];
    for (const suit of suits) {
      for (const value of values) {
        this.deck.push({ ...value, suit });
      }
    }
    
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  distributeCards() {
    this.createDeck();
    this.playerCards = {};
    
    this.players.forEach(player => {
      this.playerCards[player.id] = this.deck.splice(0, 4);
    });
  }

  startMusDecision() {
    this.state = 'MUS_DECISION';
    this.musVotes = {};
  }

  handleMusVote(playerId, wantsMus) {
    this.musVotes[playerId] = wantsMus;
    
    if (Object.keys(this.musVotes).length === 4) {
      const allWantMus = Object.values(this.musVotes).every(v => v === true);
      
      if (allWantMus) {
        this.distributeCards();
        this.startMusDecision();
        return { action: 'REDISTRIBUTE', allWantMus: true };
      } else {
        this.startBettingPhase('GRAND');
        return { action: 'START_BETTING', phase: 'GRAND' };
      }
    }
    
    return { action: 'WAITING', votesCount: Object.keys(this.musVotes).length };
  }

  // ==================== SPRINT 3: SYSTÈME DE MISES ====================
  
  startBettingPhase(phase) {
    this.state = `BETTING_${phase}`;
    this.currentPhase = phase;
    this.bettingState = {
      phase,
      currentBet: 0,
      totalStake: 0,
      bets: [],
      currentBettorIndex: this.manoPosition,
      hordago: false,
      kantaCount: 0,
      passed: new Set(),
      activePlayers: [0, 1, 2, 3]
    };
    
    this.logAction('BETTING_START', { phase, mano: this.manoPosition });
  }

  handleBet(playerId, betType, betValue = null) {
    const bs = this.bettingState;
    
    if (this.players[bs.currentBettorIndex].id !== playerId) {
      return { success: false, error: 'Pas votre tour' };
    }

    let betResult = null;

    switch (betType) {
      case 'PASO':
        bs.passed.add(playerId);
        betResult = this.handlePaso(playerId);
        break;
        
      case 'IMIDO':
        betResult = this.handleImido(playerId);
        break;
        
      case 'KANTA':
        if (bs.kantaCount >= GAME_CONFIG.MAX_KANTA) {
          return { success: false, error: 'Trop de relances' };
        }
        betResult = this.handleKanta(playerId, betValue);
        break;
        
      case 'HORDAGO':
        betResult = this.handleHordago(playerId);
        break;
        
      case 'BET':
        if (!GAME_CONFIG.BET_VALUES.includes(betValue)) {
          return { success: false, error: 'Mise invalide' };
        }
        betResult = this.handleInitialBet(playerId, betValue);
        break;
        
      default:
        return { success: false, error: 'Action invalide' };
    }

    this.logAction('BET', { playerId, betType, betValue, result: betResult });
    
    return { success: true, ...betResult };
  }

  handlePaso(playerId) {
    const bs = this.bettingState;
    
    if (bs.bets.length === 0) {
      this.nextBettor();
      return { action: 'NEXT_BETTOR', passed: true };
    }
    
    bs.activePlayers = bs.activePlayers.filter(p => p !== playerId);
    
    if (this.isBettingPhaseComplete()) {
      return this.completeBettingPhase();
    }
    
    this.nextBettor();
    return { action: 'NEXT_BETTOR', passed: true };
  }

  handleImido(playerId) {
    const bs = this.bettingState;
    bs.bets.push({ playerId, type: 'IMIDO', value: bs.currentBet });
    
    if (this.isBettingPhaseComplete()) {
      return this.completeBettingPhase();
    }
    
    this.nextBettor();
    return { action: 'NEXT_BETTOR', accepted: true };
  }

  handleKanta(playerId, betValue) {
    const bs = this.bettingState;
    const raise = betValue || (bs.currentBet + 1);
    
    bs.bets.push({ playerId, type: 'KANTA', value: raise });
    bs.currentBet = raise;
    bs.kantaCount++;
    bs.passed.clear();
    
    this.nextBettor();
    return { action: 'RAISED', newBet: raise };
  }

  handleHordago(playerId) {
    const bs = this.bettingState;
    bs.hordago = true;
    bs.bets.push({ playerId, type: 'HORDAGO', value: 'ALL' });
    
    return { action: 'HORDAGO', resolveAll: true };
  }

  handleInitialBet(playerId, betValue) {
    const bs = this.bettingState;
    bs.bets.push({ playerId, type: 'BET', value: betValue });
    bs.currentBet = betValue;
    
    this.nextBettor();
    return { action: 'BET_PLACED', bet: betValue };
  }

  nextBettor() {
    const bs = this.bettingState;
    do {
      bs.currentBettorIndex = (bs.currentBettorIndex + 1) % 4;
    } while (!bs.activePlayers.includes(bs.currentBettorIndex));
  }

  isBettingPhaseComplete() {
    const bs = this.bettingState;
    
    if (bs.hordago) return true;
    if (bs.activePlayers.length === 1) return true;
    
    const spokeCount = bs.bets.length + bs.passed.size;
    if (spokeCount >= 4 && bs.passed.size < 4) return true;
    
    return false;
  }

  completeBettingPhase() {
    const bs = this.bettingState;
    
    const phaseWinner = this.determinePhaseWinner(bs.phase);
    
    let pointsWon = bs.currentBet || 1;
    if (bs.hordago) {
      pointsWon = this.winScore - Math.max(this.scores.A, this.scores.B);
    }
    
    if (phaseWinner.winner) {
      this.scores[phaseWinner.winner] += pointsWon;
      this.players.forEach(p => {
        const team = p.position % 2 === 0 ? 'A' : 'B';
        if (team === phaseWinner.winner) {
          p.stats.pointsScored += pointsWon;
          p.stats.betsWon++;
        }
      });
    }
    
    this.phaseResults[bs.phase] = {
      winner: phaseWinner.winner,
      points: pointsWon,
      details: phaseWinner.details,
      bets: bs.bets
    };
    
    if (bs.hordago) {
      return this.endRound();
    }
    
    return this.moveToNextPhase();
  }

  detectPaires(cards) {
    const valueCounts = {};
    cards.forEach(card => {
      const val = card.name;
      valueCounts[val] = (valueCounts[val] || 0) + 1;
    });

    const counts = Object.values(valueCounts).sort((a, b) => b - a);
    
    if (counts[0] === 4) {
      return { type: 'ZORTZIKOAK', value: 40, name: 'Zortzikoak' };
    }
    
    if (counts[0] === 2 && counts[1] === 2) {
      return { type: 'DUPLES', value: 3, name: 'Duples' };
    }
    
    if (counts[0] === 2) {
      const pairValue = Object.keys(valueCounts).find(k => valueCounts[k] === 2);
      if (pairValue === 'R' || pairValue === '3') {
        return { type: 'MEDIAS', value: 2, name: `Médias (${pairValue})` };
      }
      return { type: 'PAR', value: 1, name: `Paire de ${pairValue}` };
    }
    
    return { type: 'NONE', value: 0, name: 'Pas de paire' };
  }

  calculateJeu(cards) {
    const total = cards.reduce((sum, card) => sum + card.gameValue, 0);
    return {
      total,
      hasJeu: total >= 31,
      points: total >= 31 ? (total === 31 ? 3 : total === 32 ? 2 : 1) : 0
    };
  }

  determinePhaseWinner(phase) {
    const teamACards = [
      ...this.playerCards[this.teams.A[0].id],
      ...this.playerCards[this.teams.A[1].id]
    ];
    const teamBCards = [
      ...this.playerCards[this.teams.B[0].id],
      ...this.playerCards[this.teams.B[1].id]
    ];

    let result = 0;
    let details = {};

    switch(phase) {
      case 'GRAND':
        const bestA_Grand = Math.max(
          Math.max(...this.playerCards[this.teams.A[0].id].map(c => c.grandValue)),
          Math.max(...this.playerCards[this.teams.A[1].id].map(c => c.grandValue))
        );
        const bestB_Grand = Math.max(
          Math.max(...this.playerCards[this.teams.B[0].id].map(c => c.grandValue)),
          Math.max(...this.playerCards[this.teams.B[1].id].map(c => c.grandValue))
        );
        result = bestA_Grand > bestB_Grand ? 1 : (bestA_Grand < bestB_Grand ? -1 : 0);
        details = { teamA: bestA_Grand, teamB: bestB_Grand };
        break;

      case 'PETIT':
        const bestA_Petit = Math.min(
          Math.min(...this.playerCards[this.teams.A[0].id].map(c => c.petitValue)),
          Math.min(...this.playerCards[this.teams.A[1].id].map(c => c.petitValue))
        );
        const bestB_Petit = Math.min(
          Math.min(...this.playerCards[this.teams.B[0].id].map(c => c.petitValue)),
          Math.min(...this.playerCards[this.teams.B[1].id].map(c => c.petitValue))
        );
        result = bestA_Petit < bestB_Petit ? 1 : (bestA_Petit > bestB_Petit ? -1 : 0);
        details = { teamA: bestA_Petit, teamB: bestB_Petit };
        break;

      case 'PAIRES':
        const pairesA1 = this.detectPaires(this.playerCards[this.teams.A[0].id]);
        const pairesA2 = this.detectPaires(this.playerCards[this.teams.A[1].id]);
        const pairesB1 = this.detectPaires(this.playerCards[this.teams.B[0].id]);
        const pairesB2 = this.detectPaires(this.playerCards[this.teams.B[1].id]);
        
        const bestPairesA = pairesA1.value > pairesA2.value ? pairesA1 : pairesA2;
        const bestPairesB = pairesB1.value > pairesB2.value ? pairesB1 : pairesB2;
        
        result = bestPairesA.value > bestPairesB.value ? 1 : (bestPairesA.value < bestPairesB.value ? -1 : 0);
        details = { teamA: bestPairesA, teamB: bestPairesB };
        break;

      case 'JEU':
        const jeuA1 = this.calculateJeu(this.playerCards[this.teams.A[0].id]);
        const jeuA2 = this.calculateJeu(this.playerCards[this.teams.A[1].id]);
        const jeuB1 = this.calculateJeu(this.playerCards[this.teams.B[0].id]);
        const jeuB2 = this.calculateJeu(this.playerCards[this.teams.B[1].id]);
        
        const bestJeuA = jeuA1.total > jeuA2.total ? jeuA1 : jeuA2;
        const bestJeuB = jeuB1.total > jeuB2.total ? jeuB1 : jeuB2;
        
        if (!bestJeuA.hasJeu && !bestJeuB.hasJeu) {
          return { winner: null, goPuntuak: true, details };
        }
        
        if (bestJeuA.hasJeu && !bestJeuB.hasJeu) result = 1;
        else if (!bestJeuA.hasJeu && bestJeuB.hasJeu) result = -1;
        else result = bestJeuA.total > bestJeuB.total ? 1 : (bestJeuA.total < bestJeuB.total ? -1 : 0);
        
        details = { teamA: bestJeuA, teamB: bestJeuB };
        break;

      case 'PUNTUAK':
        const totalA = this.playerCards[this.teams.A[0].id].reduce((s, c) => s + c.gameValue, 0) +
                       this.playerCards[this.teams.A[1].id].reduce((s, c) => s + c.gameValue, 0);
        const totalB = this.playerCards[this.teams.B[0].id].reduce((s, c) => s + c.gameValue, 0) +
                       this.playerCards[this.teams.B[1].id].reduce((s, c) => s + c.gameValue, 0);
        
        result = totalA > totalB ? 1 : (totalA < totalB ? -1 : 0);
        details = { teamA: totalA, teamB: totalB };
        break;
    }

    if (result === 0) {
      const manoTeam = this.manoPosition % 2 === 0 ? 'A' : 'B';
      result = manoTeam === 'A' ? 1 : -1;
      details.tieBreaker = 'Mano';
    }

    const winner = result > 0 ? 'A' : 'B';
    
    return { winner, details, goPuntuak: false };
  }

  moveToNextPhase() {
    this.currentPhaseIndex++;
    
    if (this.currentPhaseIndex >= this.phases.length) {
      return this.endRound();
    }

    const nextPhase = this.phases[this.currentPhaseIndex];
    this.startBettingPhase(nextPhase);
    
    return { nextPhase, phaseResult: this.phaseResults };
  }

  // ==================== SPRINT 4: FIN DE MANCHE & PARTIE ====================
  
  endRound() {
    this.roundHistory.push({
      timestamp: Date.now(),
      scores: { ...this.scores },
      phaseResults: { ...this.phaseResults }
    });
    
    if (this.scores.A >= this.winScore || this.scores.B >= this.winScore) {
      return this.endGame();
    }
    
    this.dealerPosition = (this.dealerPosition + 1) % 4;
    this.manoPosition = (this.manoPosition + 1) % 4;
    this.phaseResults = {};
    this.currentPhaseIndex = 0;
    
    this.state = 'ROUND_ENDED';
    
    return { 
      action: 'ROUND_END',
      scores: this.scores,
      nextRound: true,
      phaseResults: this.phaseResults
    };
  }

  endGame() {
    const winner = this.scores.A >= this.winScore ? 'A' : 'B';
    const duration = Date.now() - this.gameStartTime;
    
    this.players.forEach(p => {
      const team = p.position % 2 === 0 ? 'A' : 'B';
      if (team === winner) {
        p.stats.roundsWon++;
      }
    });
    
    this.state = 'GAME_ENDED';
    
    return {
      action: 'GAME_END',
      winner,
      finalScores: this.scores,
      duration,
      stats: this.players.map(p => ({
        name: p.name,
        stats: p.stats
      }))
    };
  }

  startNewRound() {
    this.distributeCards();
    this.startMusDecision();
    this.state = 'MUS_DECISION';
  }

  logAction(type, data) {
    this.history.push({
      timestamp: Date.now(),
      type,
      data
    });
    this.lastActivity = Date.now();
  }

  getGameState(forPlayerId) {
    const player = this.players.find(p => p.id === forPlayerId);
    const team = player ? (player.position % 2 === 0 ? 'A' : 'B') : null;
    
    return {
      roomId: this.roomId,
      state: this.state,
      currentPhase: this.currentPhase,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        connected: p.connected,
        stats: p.stats
      })),
      teams: {
        A: this.teams.A.map(p => ({ id: p.id, name: p.name })),
        B: this.teams.B.map(p => ({ id: p.id, name: p.name }))
      },
      myCards: this.playerCards[forPlayerId] || [],
      myPosition: forPlayerId,
      myTeam: team,
      dealerPosition: this.dealerPosition,
      manoPosition: this.manoPosition,
      isDealer: forPlayerId === this.dealerPosition,
      isMano: forPlayerId === this.manoPosition,
      scores: this.scores,
      winScore: this.winScore,
      musVotes: this.musVotes,
      phaseResults: this.phaseResults,
      bettingState: this.bettingState,
      waitingForMus: this.state === 'MUS_DECISION' && !this.musVotes[forPlayerId],
      currentBettor: this.bettingState.currentBettorIndex,
      isMyTurn: this.players[this.bettingState.currentBettorIndex]?.id === forPlayerId,
      roundHistory: this.roundHistory.slice(-5)
    };
  }
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ==================== WEBSOCKET HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connecté: ${socket.id}`);

  socket.on('CREATE_ROOM', ({ playerName, config }) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id, playerName, config);
    rooms.set(roomId, room);
    
    playerSockets.set(socket.id, { roomId, playerId: 0 });
    socket.join(roomId);
    
    console.log(`[${roomId}] Salle créée par ${playerName}`);
    
    socket.emit('ROOM_CREATED', {
      roomId,
      gameState: room.getGameState(0)
    });

    io.to(roomId).emit('GAME_STATE_UPDATE', {
      gameState: room.getGameState(0)
    });
  });

  socket.on('JOIN_ROOM', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('ERROR', { message: 'Salle introuvable' });
      return;
    }

    const result = room.addPlayer(socket.id, playerName);
    
    if (!result.success) {
      socket.emit('ERROR', { message: result.error });
      return;
    }

    const playerId = result.player.id;
    playerSockets.set(socket.id, { roomId, playerId });
    socket.join(roomId);

    console.log(`[${roomId}] ${playerName} a rejoint`);

    room.players.forEach(player => {
      io.to(player.socketId).emit('GAME_STATE_UPDATE', {
        gameState: room.getGameState(player.id)
      });
    });

    if (room.players.length === 4) {
      io.to(roomId).emit('TEAMS_ASSIGNED', { teams: room.teams });
    }
  });

  socket.on('START_GAME', () => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.players.length !== 4) {
      socket.emit('ERROR', { message: '4 joueurs requis' });
      return;
    }

    room.gameStartTime = Date.now();
    room.distributeCards();
    room.startMusDecision();

    console.log(`[${room.roomId}] Partie démarrée`);

    room.players.forEach(player => {
      io.to(player.socketId).emit('GAME_STARTED', {
        gameState: room.getGameState(player.id)
      });
    });
  });

  socket.on('MUS_VOTE', ({ wantsMus }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.state !== 'MUS_DECISION') {
      socket.emit('ERROR', { message: 'Action impossible' });
      return;
    }

    const result = room.handleMusVote(playerData.playerId, wantsMus);

    if (result.action === 'REDISTRIBUTE') {
      room.players.forEach(player => {
        io.to(player.socketId).emit('MUS_ACCEPTED', {
          gameState: room.getGameState(player.id)
        });
      });
    } else if (result.action === 'START_BETTING') {
      room.players.forEach(player => {
        io.to(player.socketId).emit('BETTING_STARTED', {
          phase: result.phase,
          gameState: room.getGameState(player.id)
        });
      });
    } else {
      room.players.forEach(player => {
        io.to(player.socketId).emit('GAME_STATE_UPDATE', {
          gameState: room.getGameState(player.id)
        });
      });
    }
  });

  socket.on('PLACE_BET', ({ betType, betValue }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room) return;

    const result = room.handleBet(playerData.playerId, betType, betValue);

    if (!result.success) {
      socket.emit('ERROR', { message: result.error });
      return;
    }

    console.log(`[${room.roomId}] Mise: ${betType} ${betValue || ''}`);

    room.players.forEach(player => {
      io.to(player.socketId).emit('BET_UPDATE', {
        betResult: result,
        gameState: room.getGameState(player.id)
      });
    });

    if (result.action === 'ROUND_END' || result.action === 'GAME_END') {
      room.players.forEach(player => {
        io.to(player.socketId).emit(result.action === 'GAME_END' ? 'GAME_ENDED' : 'ROUND_ENDED', {
          ...result,
          gameState: room.getGameState(player.id)
        });
      });
    }
  });

  socket.on('START_NEW_ROUND', () => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.state !== 'ROUND_ENDED') return;

    room.startNewRound();

    room.players.forEach(player => {
      io.to(player.socketId).emit('NEW_ROUND_STARTED', {
        gameState: room.getGameState(player.id)
      });
    });
  });

  socket.on('LEAVE_ROOM', () => {
    handlePlayerDisconnect(socket);
  });

  socket.on('disconnect', () => {
    console.log(`Client déconnecté: ${socket.id}`);
    handlePlayerDisconnect(socket);
  });

  socket.on('PING', () => {
    socket.emit('PONG');
  });
});

function handlePlayerDisconnect(socket) {
  const playerData = playerSockets.get(socket.id);
  if (!playerData) return;

  const room = rooms.get(playerData.roomId);
  if (!room) return;

  const player = room.players.find(p => p.id === playerData.playerId);
  if (player) {
    player.connected = false;
    
    io.to(playerData.roomId).emit('PLAYER_DISCONNECTED', {
      playerId: playerData.playerId,
      playerName: player.name
    });

    setTimeout(() => {
      if (!player.connected) {
        room.removePlayer(socket.id);
        
        if (room.players.length < 4) {
          io.to(playerData.roomId).emit('GAME_CANCELLED', {
            message: 'Partie annulée'
          });
          
          if (room.players.length === 0) {
            rooms.delete(playerData.roomId);
          }
        }
      }
    }, GAME_CONFIG.RECONNECT_TIMEOUT);
  }

  playerSockets.delete(socket.id);
}

// ==================== ROUTES HTTP ====================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    activePlayers: playerSockets.size
  });
});

app.get('/stats', (req, res) => {
  const roomsData = Array.from(rooms.values()).map(room => ({
    roomId: room.roomId,
    state: room.state,
    playersCount: room.players.length,
    scores: room.scores
  }));

  res.json({
    rooms: roomsData,
    totalRooms: rooms.size,
    totalPlayers: playerSockets.size
  });
});

// Route catch-all pour servir le frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

// ==================== DÉMARRAGE ====================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎴 Serveur MUS BASQUE - v2.0`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log('='.repeat(50));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
