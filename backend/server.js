// server.js - Backend Node.js pour le jeu de Mus Basque
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
// ==================== ï¿½TAT DU JEU ====================

const rooms = new Map(); // roomId => Room
const playerSockets = new Map(); // socketId => { roomId, playerId }

class Room {
  constructor(roomId, creatorSocketId, creatorName) {
    this.roomId = roomId;
    this.players = [];
    this.state = 'WAITING'; // WAITING, LOBBY, MUS_DECISION, GRAND, PETIT, PAIRES, JEU, PUNTUAK, FINISHED
    this.teams = { A: [], B: [] };
    this.dealerPosition = 0;
    this.currentTurn = 0;
    this.deck = [];
    this.playerCards = {}; // playerId => [cards]
    this.musVotes = {}; // playerId => boolean
    this.scores = { A: 0, B: 0 };
    this.currentBet = null;
    
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

    // Auto-attribution des ï¿½quipes quand 4 joueurs
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
      // Rï¿½assigner les positions
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
    // ï¿½quipe A: positions 0 et 2
    // ï¿½quipe B: positions 1 et 3
    this.teams.A = [this.players[0], this.players[2]];
    this.teams.B = [this.players[1], this.players[3]];
  }

  createDeck() {
    const suits = ['?', '<3', '?', '?'];
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
    
    // Mï¿½langer le paquet
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
    
    // Si tous ont votï¿½
    if (Object.keys(this.musVotes).length === 4) {
      const allWantMus = Object.values(this.musVotes).every(v => v === true);
      
      if (allWantMus) {
        // Redistribuer les cartes
        this.distributeCards();
        this.startMusDecision();
        return { action: 'REDISTRIBUTE', allWantMus: true };
      } else {
        // Commencer la phase Grand
        this.state = 'GRAND';
        return { action: 'START_GRAND', allWantMus: false };
      }
    }
    
    return { action: 'WAITING', votesCount: Object.keys(this.musVotes).length };
  }

  getGameState(forPlayerId) {
    return {
      roomId: this.roomId,
      state: this.state,
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
      isDealer: forPlayerId === this.dealerPosition,
      currentTurn: this.currentTurn,
      scores: this.scores,
      musVotes: this.musVotes,
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
  console.log(`[${new Date().toISOString()}] Nouveau client connectï¿½: ${socket.id}`);

  // US1 & US2: Crï¿½er ou rejoindre une salle
  socket.on('CREATE_ROOM', ({ playerName }) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id, playerName);
    rooms.set(roomId, room);
    
    playerSockets.set(socket.id, {
      roomId,
      playerId: 0
    });

    socket.join(roomId);
    
    console.log(`[${roomId}] Salle crï¿½ï¿½e par ${playerName}`);
    
    socket.emit('ROOM_CREATED', {
      roomId,
      gameState: room.getGameState(0)
    });

    // Broadcaster l'ï¿½tat ï¿½ tous dans la salle
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

    console.log(`[${roomId}] ${playerName} a rejoint (joueur ${playerId})`);

    // Envoyer l'ï¿½tat ï¿½ tous les joueurs
    room.players.forEach(player => {
      io.to(player.socketId).emit('GAME_STATE_UPDATE', {
        gameState: room.getGameState(player.id)
      });
    });

    // US3: Si 4 joueurs, les ï¿½quipes sont auto-attribuï¿½es
    if (room.players.length === 4) {
      io.to(roomId).emit('TEAMS_ASSIGNED', {
        teams: room.teams
      });
    }
  });

  // US4 & US5: Dï¿½marrer la partie (uniquement si 4 joueurs)
  socket.on('START_GAME', () => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.players.length !== 4) {
      socket.emit('ERROR', { message: 'Impossible de dï¿½marrer: 4 joueurs requis' });
      return;
    }

    // US8: Distribuer 4 cartes ï¿½ chaque joueur
    room.distributeCards();
    
    // US10: Demander le Mus ï¿½ tous
    room.startMusDecision();

    console.log(`[${room.roomId}] Partie dï¿½marrï¿½e - Distribution des cartes`);

    // Envoyer les cartes ï¿½ chaque joueur individuellement
    room.players.forEach(player => {
      io.to(player.socketId).emit('GAME_STARTED', {
        gameState: room.getGameState(player.id)
      });
    });
  });

  // US9 & US10 & US11 & US12: Gestion du vote Mus
  socket.on('MUS_VOTE', ({ wantsMus }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.state !== 'MUS_DECISION') {
      socket.emit('ERROR', { message: 'Action impossible dans cette phase' });
      return;
    }

    const result = room.handleMusVote(playerData.playerId, wantsMus);

    console.log(`[${room.roomId}] Joueur ${playerData.playerId} vote Mus: ${wantsMus}`);

    if (result.action === 'REDISTRIBUTE') {
      // US11: Tous acceptent le Mus - redistribuer
      console.log(`[${room.roomId}] Tous acceptent le Mus - Redistribution`);
      
      room.players.forEach(player => {
        io.to(player.socketId).emit('MUS_ACCEPTED', {
          message: 'Tous les joueurs acceptent le Mus - Nouvelles cartes',
          gameState: room.getGameState(player.id)
        });
      });
    } else if (result.action === 'START_GRAND') {
      // US12: Un joueur refuse - commencer la phase Grand
      console.log(`[${room.roomId}] Mus refusï¿½ - Dï¿½but de la phase Grand`);
      
      room.players.forEach(player => {
        io.to(player.socketId).emit('MUS_REFUSED', {
          message: 'Un joueur refuse le Mus - Dï¿½but du jeu',
          gameState: room.getGameState(player.id)
        });
      });
    } else {
      // En attente d'autres votes
      room.players.forEach(player => {
        io.to(player.socketId).emit('GAME_STATE_UPDATE', {
          gameState: room.getGameState(player.id),
          message: `${result.votesCount}/4 joueurs ont votï¿½`
        });
      });
    }
  });

  // US7: Quitter la partie proprement
  socket.on('LEAVE_ROOM', () => {
    handlePlayerDisconnect(socket);
  });

  // US36: Gï¿½rer les dï¿½connexions
  socket.on('disconnect', () => {
    console.log(`[${new Date().toISOString()}] Client dï¿½connectï¿½: ${socket.id}`);
    handlePlayerDisconnect(socket);
  });

  // US35 & US37: Validation du tour et actions interdites
  socket.on('PLAYER_ACTION', ({ action, data }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) {
      socket.emit('ERROR', { message: 'Session invalide' });
      return;
    }

    const room = rooms.get(playerData.roomId);
    if (!room) {
      socket.emit('ERROR', { message: 'Salle introuvable' });
      return;
    }

    // Vï¿½rifier si c'est le tour du joueur
    if (room.currentTurn !== playerData.playerId && room.state !== 'MUS_DECISION') {
      socket.emit('ERROR', { 
        message: 'Ce n\'est pas votre tour',
        currentTurn: room.currentTurn 
      });
      return;
    }

    console.log(`[${room.roomId}] Action ${action} du joueur ${playerData.playerId}`);
    
    // Traitement des actions selon la phase
    // (ï¿½ implï¿½menter dans les prochains sprints)
  });

  // Heartbeat pour maintenir la connexion
  socket.on('PING', () => {
    socket.emit('PONG');
  });
});

// ==================== GESTION DES Dï¿½CONNEXIONS ====================

function handlePlayerDisconnect(socket) {
  const playerData = playerSockets.get(socket.id);
  
  if (!playerData) return;

  const room = rooms.get(playerData.roomId);
  if (!room) return;

  const player = room.players.find(p => p.id === playerData.playerId);
  if (player) {
    player.connected = false;
    console.log(`[${room.roomId}] ${player.name} s'est dï¿½connectï¿½`);
    
    // Notifier les autres joueurs
    io.to(playerData.roomId).emit('PLAYER_DISCONNECTED', {
      playerId: playerData.playerId,
      playerName: player.name
    });

    // Attendre 60 secondes avant de retirer dï¿½finitivement
    setTimeout(() => {
      if (!player.connected) {
        room.removePlayer(socket.id);
        console.log(`[${room.roomId}] ${player.name} retirï¿½ de la partie (timeout)`);
        
        // Si moins de 4 joueurs, arrï¿½ter la partie
        if (room.players.length < 4) {
          io.to(playerData.roomId).emit('GAME_CANCELLED', {
            message: 'Partie annulï¿½e - Pas assez de joueurs'
          });
          
          // Si la salle est vide, la supprimer
          if (room.players.length === 0) {
            rooms.delete(playerData.roomId);
            console.log(`[${playerData.roomId}] Salle supprimï¿½e`);
          }
        } else {
          // Mettre ï¿½ jour l'ï¿½tat pour les joueurs restants
          room.players.forEach(p => {
            io.to(p.socketId).emit('GAME_STATE_UPDATE', {
              gameState: room.getGameState(p.id)
            });
          });
        }
      }
    }, 60000); // 60 secondes
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

// ==================== Dï¿½MARRAGE DU SERVEUR ====================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`? Serveur MUS BASQUE dï¿½marrï¿½`);
  console.log(`? Port: ${PORT}`);
  console.log(`? Dï¿½marrï¿½ ï¿½: ${new Date().toISOString()}`);
  console.log('='.repeat(50));
});

// Nettoyage gracieux
process.on('SIGTERM', () => {
  console.log('SIGTERM reï¿½u, fermeture du serveur...');
  server.close(() => {
    console.log('Serveur fermï¿½ proprement');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT reï¿½u, fermeture du serveur...');
  server.close(() => {
    console.log('Serveur fermï¿½ proprement');
    process.exit(0);
  });

});
