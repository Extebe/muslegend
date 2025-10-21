// server.js - Backend Sprint 2 - Game Logic complète
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

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

// ==================== ÉTAT DU JEU ====================

const rooms = new Map();
const playerSockets = new Map();

class Room {
  constructor(roomId, creatorSocketId, creatorName) {
    this.roomId = roomId;
    this.players = [];
    this.state = 'WAITING';
    this.teams = { A: [], B: [] };
    this.dealerPosition = 0;
    this.manoPosition = 0; // Position de la mano (celui qui parle en premier)
    this.currentPhase = null; // GRAND, PETIT, PAIRES, JEU, PUNTUAK
    this.deck = [];
    this.playerCards = {};
    this.musVotes = {};
    this.scores = { A: 0, B: 0 };
    this.phaseResults = {}; // Résultats de chaque phase
    this.currentPhaseIndex = 0;
    this.phases = ['GRAND', 'PETIT', 'PAIRES', 'JEU']; // Ordre des phases
    
    this.addPlayer(creatorSocketId, creatorName);
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 4) {
      return { success: false, error: 'Salle pleine' };
    }

    const player = {
      id: this.players.length,
      socketId,
      name,
      position: this.players.length,
      connected: true
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
    
    // Mélanger
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
        // US21: Commencer la phase Grand
        this.startGrandPhase();
        return { action: 'START_GRAND', allWantMus: false };
      }
    }
    
    return { action: 'WAITING', votesCount: Object.keys(this.musVotes).length };
  }

  // ==================== US21: DÉMARRER LA PHASE GRAND ====================
  startGrandPhase() {
    this.state = 'GRAND';
    this.currentPhase = 'GRAND';
    this.currentPhaseIndex = 0;
  }

  // ==================== US43: COMPARAISON GRAND ====================
  // Hiérarchie: Roi(14) > 3(13) > Cavalier(8) > Valet(7) > 7(6) > 6(5) > 5(4) > 4(3) > 2(2) > As(1)
  compareGrand(cards1, cards2) {
    const max1 = Math.max(...cards1.map(c => c.grandValue));
    const max2 = Math.max(...cards2.map(c => c.grandValue));
    
    if (max1 > max2) return 1;
    if (max1 < max2) return -1;
    return 0; // Égalité
  }

  // ==================== US44: COMPARAISON PETIT ====================
  // Hiérarchie: As(1) < 2(2) < 4(3) < 5(4) < 6(5) < 7(6) < Valet(7) < Cavalier(8) < 3(11) < Roi(12)
  comparePetit(cards1, cards2) {
    const min1 = Math.min(...cards1.map(c => c.petitValue));
    const min2 = Math.min(...cards2.map(c => c.petitValue));
    
    if (min1 < min2) return 1;
    if (min1 > min2) return -1;
    return 0; // Égalité
  }

  // ==================== US45: DÉTECTION PAIRES ====================
  detectPaires(cards) {
    const valueCounts = {};
    cards.forEach(card => {
      const val = card.name;
      valueCounts[val] = (valueCounts[val] || 0) + 1;
    });

    const counts = Object.values(valueCounts).sort((a, b) => b - a);
    
    // Zortzikoak (4 cartes identiques) - impossible au mus classique mais on gère
    if (counts[0] === 4) {
      return { type: 'ZORTZIKOAK', value: 40, name: 'Zortzikoak' };
    }
    
    // Duples (2 paires)
    if (counts[0] === 2 && counts[1] === 2) {
      return { type: 'DUPLES', value: 3, name: 'Duples (2 paires)' };
    }
    
    // Médias (Paire de Rois ou de 3)
    if (counts[0] === 2) {
      const pairValue = Object.keys(valueCounts).find(k => valueCounts[k] === 2);
      if (pairValue === 'R' || pairValue === '3') {
        return { type: 'MEDIAS', value: 2, name: `Médias (paire de ${pairValue})` };
      }
      // Paire simple (Par)
      return { type: 'PAR', value: 1, name: `Paire de ${pairValue}` };
    }
    
    // Pas de paire
    return { type: 'NONE', value: 0, name: 'Pas de paire' };
  }

  comparePaires(cards1, cards2) {
    const paires1 = this.detectPaires(cards1);
    const paires2 = this.detectPaires(cards2);
    
    if (paires1.value > paires2.value) return 1;
    if (paires1.value < paires2.value) return -1;
    return 0; // Égalité
  }

  // ==================== US46: CALCUL DU JEU ====================
  calculateJeu(cards) {
    const total = cards.reduce((sum, card) => sum + card.gameValue, 0);
    return {
      total,
      hasJeu: total >= 31,
      points: total >= 31 ? (total === 31 ? 3 : total === 32 ? 2 : 1) : 0
    };
  }

  compareJeu(cards1, cards2) {
    const jeu1 = this.calculateJeu(cards1);
    const jeu2 = this.calculateJeu(cards2);
    
    // Si aucun n'a de jeu, on passe à Puntuak
    if (!jeu1.hasJeu && !jeu2.hasJeu) {
      return { result: 0, goPuntuak: true };
    }
    
    if (jeu1.hasJeu && !jeu2.hasJeu) return { result: 1, goPuntuak: false };
    if (!jeu1.hasJeu && jeu2.hasJeu) return { result: -1, goPuntuak: false };
    
    // Les deux ont du jeu, comparer les totaux
    if (jeu1.total > jeu2.total) return { result: 1, goPuntuak: false };
    if (jeu1.total < jeu2.total) return { result: -1, goPuntuak: false };
    return { result: 0, goPuntuak: false }; // Égalité
  }

  // ==================== US54: PUNTUAK ====================
  comparePuntuak(cards1, cards2) {
    const total1 = cards1.reduce((sum, card) => sum + card.gameValue, 0);
    const total2 = cards2.reduce((sum, card) => sum + card.gameValue, 0);
    
    if (total1 > total2) return 1;
    if (total1 < total2) return -1;
    return 0;
  }

  // ==================== US24: DÉTERMINER LE GAGNANT D'UNE PHASE ====================
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
        // Comparer le meilleur Grand de chaque équipe
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
        
        // Si aucun n'a de jeu, on va en Puntuak
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

    // US53: En cas d'égalité, le point va à la Mano
    if (result === 0) {
      const manoTeam = this.manoPosition % 2 === 0 ? 'A' : 'B';
      result = manoTeam === 'A' ? 1 : -1;
      details.tieBreaker = 'Mano';
    }

    const winner = result > 0 ? 'A' : 'B';
    
    return { winner, details, goPuntuak: false };
  }

  // ==================== US25 & US26: PASSER À LA PHASE SUIVANTE ====================
  moveToNextPhase() {
    // Déterminer le gagnant de la phase actuelle
    const phaseResult = this.determinePhaseWinner(this.currentPhase);
    
    this.phaseResults[this.currentPhase] = phaseResult;
    
    // Attribuer 1 point (pour l'instant, Sprint 3 gérera les mises)
    if (phaseResult.winner) {
      this.scores[phaseResult.winner] += 1;
    }

    // US26: Si on est au JEU et personne n'a de jeu, passer à PUNTUAK
    if (this.currentPhase === 'JEU' && phaseResult.goPuntuak) {
      this.state = 'PUNTUAK';
      this.currentPhase = 'PUNTUAK';
      return { nextPhase: 'PUNTUAK', phaseResult };
    }

    // Passer à la phase suivante
    this.currentPhaseIndex++;
    
    if (this.currentPhaseIndex >= this.phases.length) {
      // Fin de la manche
      this.state = 'MANCHE_FINISHED';
      return { nextPhase: 'FINISHED', phaseResult };
    }

    this.currentPhase = this.phases[this.currentPhaseIndex];
    this.state = this.currentPhase;
    
    return { nextPhase: this.currentPhase, phaseResult };
  }

  // Pour l'instant, fonction simplifiée pour passer la phase (Sprint 3 gérera les mises)
  passPhase() {
    return this.moveToNextPhase();
  }

  getGameState(forPlayerId) {
    return {
      roomId: this.roomId,
      state: this.state,
      currentPhase: this.currentPhase,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        connected: p.connected
      })),
      teams: {
        A: this.teams.A.map(p => ({ id: p.id, name: p.name })),
        B: this.teams.B.map(p => ({ id: p.id, name: p.name }))
      },
      myCards: this.playerCards[forPlayerId] || [],
      myPosition: forPlayerId,
      dealerPosition: this.dealerPosition,
      manoPosition: this.manoPosition,
      isDealer: forPlayerId === this.dealerPosition,
      isMano: forPlayerId === this.manoPosition,
      scores: this.scores,
      musVotes: this.musVotes,
      phaseResults: this.phaseResults,
      waitingForMus: this.state === 'MUS_DECISION' && !this.musVotes[forPlayerId]
    };
  }
}

// ==================== UTILITAIRES ====================

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ==================== WEBSOCKET HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connecté: ${socket.id}`);

  socket.on('CREATE_ROOM', ({ playerName }) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id, playerName);
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
    } else if (result.action === 'START_GRAND') {
      // US21: Phase Grand démarre
      room.players.forEach(player => {
        io.to(player.socketId).emit('PHASE_STARTED', {
          phase: 'GRAND',
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

  // US22: Passer la phase (simplifié pour Sprint 2, Sprint 3 gérera les mises)
  socket.on('PASS_PHASE', () => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room) return;

    const result = room.passPhase();

    console.log(`[${room.roomId}] Phase ${room.currentPhase} terminée`);

    room.players.forEach(player => {
      io.to(player.socketId).emit('PHASE_RESULT', {
        phase: result.nextPhase === 'FINISHED' ? room.phases[room.phases.length - 1] : room.phases[room.currentPhaseIndex - 1],
        result: result.phaseResult,
        nextPhase: result.nextPhase,
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
    }, 60000);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

// ==================== DÉMARRAGE ====================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎴 Serveur MUS BASQUE - Sprint 2`);
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
