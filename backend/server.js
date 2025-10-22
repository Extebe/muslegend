// server.js - Mus Basque - Règles authentiques
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

// ==================== CONFIGURATION ====================
const GAME_CONFIG = {
  MAX_PLAYERS: 4,
  RECONNECT_TIMEOUT: 60000,
  DEFAULT_WIN_SCORE: 40
};

// ==================== ÉTAT DU JEU ====================
const rooms = new Map();
const playerSockets = new Map();

class Room {
  constructor(roomId, creatorSocketId, creatorName, config = {}) {
    this.roomId = roomId;
    this.players = [];
    this.state = 'WAITING'; // WAITING, LOBBY, MUS_DECISION, BETTING_GRAND, etc.
    this.teams = { A: [], B: [] };
    this.manoPosition = 0; // Qui commence (A=0, C=1, B=2, D=3)
    this.deck = [];
    this.playerCards = {};
    this.playerDiscards = {}; // Cartes jetées pendant MUS
    this.musVotes = {}; // playerId => 'MUS' | 'JOSTA'
    this.scores = { AB: 0, CD: 0 }; // Équipe A+B vs C+D
    this.winScore = config.winScore || GAME_CONFIG.DEFAULT_WIN_SCORE;
    
    // État des mises
    this.currentPhase = null; // 'GRAND', 'PETIT', 'PAIRES', 'JEU', 'PUNTUAK'
    this.phases = ['GRAND', 'PETIT', 'PAIRES', 'JEU'];
    this.currentPhaseIndex = 0;
    this.bettingState = {
      currentBettorIndex: 0, // Index du joueur qui doit parier (0=A, 1=C, 2=B, 3=D)
      bets: [], // { playerId, action: 'PASO'|'IMIDO'|'GEHIAGO'|'IDUKI'|'TIRA'|'HORDAGO'|'KANTA', value }
      baseStake: 0, // Mise de base (IMIDO = 1)
      raiseCount: 0, // Nombre de relances
      hordago: false,
      eliminated: new Set() // Joueurs qui ont fait TIRA
    };
    
    // Résultats de la manche
    this.phaseResults = {}; // phase => { winner: 'AB'|'CD', points, details }
    this.phaseWinners = {}; // phase => 'AB'|'CD'
    this.pendingPrimes = {}; // phase => { team: 'AB'|'CD', points }
    
    this.roundHistory = [];
    this.gameStartTime = null;
    
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
      position: this.players.length, // 0=A, 1=C, 2=B, 3=D
      connected: true,
      stats: {
        roundsWon: 0,
        pointsScored: 0
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
    // A(0) et B(2) vs C(1) et D(3)
    this.teams.A = [this.players[0], this.players[2]]; // Équipe AB
    this.teams.B = [this.players[1], this.players[3]]; // Équipe CD
  }

  // ==================== CARTES ESPAGNOLES ====================
  
  createDeck() {
    const suits = ['♦', '♥', '♠', '♣']; // Oros, Copas, Espadas, Bastos
    const values = [
      { name: 'As', grandValue: 1, petitValue: 1, gameValue: 1 },
      { name: '2', grandValue: 2, petitValue: 2, gameValue: 2 },
      { name: '3', grandValue: 3, petitValue: 3, gameValue: 3 },
      { name: '4', grandValue: 4, petitValue: 4, gameValue: 4 },
      { name: '5', grandValue: 5, petitValue: 5, gameValue: 5 },
      { name: '6', grandValue: 6, petitValue: 6, gameValue: 6 },
      { name: '7', grandValue: 7, petitValue: 7, gameValue: 7 },
      { name: 'V', grandValue: 8, petitValue: 8, gameValue: 10 }, // Valet (Sota)
      { name: 'C', grandValue: 9, petitValue: 9, gameValue: 10 }, // Cavalier (Caballo)
      { name: 'R', grandValue: 10, petitValue: 10, gameValue: 10 } // Roi (Rey)
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
    this.playerDiscards = {};
    
    this.players.forEach(player => {
      this.playerCards[player.id] = this.deck.splice(0, 4);
      this.playerDiscards[player.id] = [];
    });
  }

  // ==================== MUS ====================
  
  startMusDecision() {
    this.state = 'MUS_DECISION';
    this.musVotes = {};
  }

  handleMusVote(playerId, vote) {
    // vote = 'MUS' ou 'JOSTA'
    this.musVotes[playerId] = vote;
    
    // Ordre de vote : A (mano) → C → B → D
    const voteOrder = [
      this.manoPosition,
      (this.manoPosition + 1) % 4,
      (this.manoPosition + 2) % 4,
      (this.manoPosition + 3) % 4
    ];
    
    // Vérifier si tous ont voté ou si quelqu'un a fait JOSTA
    const allVoted = voteOrder.every(pos => this.musVotes[pos] !== undefined);
    const someJosta = Object.values(this.musVotes).some(v => v === 'JOSTA');
    
    if (someJosta) {
      // Quelqu'un refuse le MUS → commencer les phases
      this.startBettingPhase('GRAND');
      return { action: 'START_BETTING', phase: 'GRAND' };
    }
    
    if (allVoted) {
      // Tous veulent MUS → passer à la jetée de cartes
      this.state = 'MUS_DISCARD';
      return { action: 'MUS_ACCEPTED', needDiscard: true };
    }
    
    return { action: 'WAITING', votesCount: Object.keys(this.musVotes).length };
  }

  handleMusDiscard(playerId, cardIndices) {
    // cardIndices = [0, 1, 2, 3] (indices des cartes à jeter, entre 0 et 3)
    if (cardIndices.length < 1 || cardIndices.length > 4) {
      return { success: false, error: 'Doit jeter entre 1 et 4 cartes' };
    }

    // Jeter les cartes
    const cardsToDiscard = cardIndices.map(idx => this.playerCards[playerId][idx]);
    this.playerDiscards[playerId] = cardsToDiscard;
    
    // Retirer les cartes de la main
    this.playerCards[playerId] = this.playerCards[playerId].filter((_, idx) => !cardIndices.includes(idx));
    
    // Piocher de nouvelles cartes
    const newCards = this.deck.splice(0, cardIndices.length);
    this.playerCards[playerId].push(...newCards);

    // Vérifier si tous ont jeté
    const allDiscarded = this.players.every(p => this.playerDiscards[p.id].length > 0);
    
    if (allDiscarded) {
      // Recommencer le vote MUS
      this.startMusDecision();
      return { action: 'RESTART_MUS_VOTE', allDiscarded: true };
    }
    
    return { action: 'WAITING_DISCARD', discardedCount: Object.keys(this.playerDiscards).filter(k => this.playerDiscards[k].length > 0).length };
  }

  // ==================== PHASES DE JEU ====================
  
  startBettingPhase(phase) {
    this.state = `BETTING_${phase}`;
    this.currentPhase = phase;
    this.bettingState = {
      currentBettorIndex: this.manoPosition, // A commence
      bets: [],
      baseStake: 0,
      raiseCount: 0,
      hordago: false,
      eliminated: new Set(),
      allPaso: true // Pour détecter si tout le monde fait PASO
    };
  }

  handleBet(playerId, action, value = null) {
    const bs = this.bettingState;
    
    // Vérifier que c'est le tour du joueur
    if (this.players[bs.currentBettorIndex].id !== playerId) {
      return { success: false, error: 'Pas votre tour' };
    }

    // Vérifier que le joueur n'est pas éliminé
    if (bs.eliminated.has(playerId)) {
      return { success: false, error: 'Vous avez fait TIRA' };
    }

    let result = null;

    switch (action) {
      case 'PASO':
        result = this.handlePaso(playerId);
        break;
        
      case 'IMIDO':
        result = this.handleImido(playerId);
        break;
        
      case 'GEHIAGO':
        result = this.handleGehiago(playerId, value);
        break;
        
      case 'IDUKI':
        result = this.handleIduki(playerId);
        break;
        
      case 'TIRA':
        result = this.handleTira(playerId);
        break;
        
      case 'HORDAGO':
        result = this.handleHordago(playerId);
        break;
        
      case 'KANTA':
        result = this.handleKanta(playerId);
        break;
        
      default:
        return { success: false, error: 'Action invalide' };
    }

    return { success: true, ...result };
  }

  handlePaso(playerId) {
    const bs = this.bettingState;
    
    // PASO n'est possible que si personne n'a encore misé
    if (bs.bets.length > 0 && bs.bets.some(b => b.action !== 'PASO')) {
      return { error: 'Impossible de faire PASO après une mise' };
    }

    bs.bets.push({ playerId, action: 'PASO' });
    
    // Passer au joueur suivant
    this.nextBettor();
    
    // Vérifier si tous ont fait PASO
    if (bs.bets.length === 4 && bs.bets.every(b => b.action === 'PASO')) {
      return this.resolveAllPaso();
    }
    
    return { action: 'NEXT_BETTOR', waitingFor: bs.currentBettorIndex };
  }

  handleImido(playerId) {
    const bs = this.bettingState;
    bs.allPaso = false;
    
    bs.bets.push({ playerId, action: 'IMIDO' });
    bs.baseStake = 1; // Mise de base = 1
    
    // Passer au joueur suivant (adversaire)
    this.nextBettor();
    
    return { action: 'IMIDO_PLACED', baseStake: 1, waitingFor: bs.currentBettorIndex };
  }

  handleGehiago(playerId, raiseAmount) {
    const bs = this.bettingState;
    bs.allPaso = false;
    
    if (!raiseAmount || raiseAmount < 1) {
      return { error: 'Montant de relance invalide' };
    }

    bs.bets.push({ playerId, action: 'GEHIAGO', value: raiseAmount });
    bs.raiseCount++;
    
    // Réinitialiser les joueurs éliminés (nouvelle relance = nouveau tour)
    bs.eliminated.clear();
    
    // Passer au joueur suivant
    this.nextBettor();
    
    return { action: 'RAISED', raiseCount: bs.raiseCount, waitingFor: bs.currentBettorIndex };
  }

  handleIduki(playerId) {
    const bs = this.bettingState;
    
    bs.bets.push({ playerId, action: 'IDUKI' });
    
    // IDUKI = on révèle et on résout la phase
    return this.resolvePhase();
  }

  handleTira(playerId) {
    const bs = this.bettingState;
    
    bs.bets.push({ playerId, action: 'TIRA' });
    bs.eliminated.add(playerId);
    
    // Calculer les points : baseStake (1) + raiseCount
    const points = bs.baseStake + bs.raiseCount;
    
    // Déterminer l'équipe gagnante (celle qui n'a pas fait TIRA)
    const playerTeam = this.getPlayerTeam(playerId);
    const winnerTeam = playerTeam === 'AB' ? 'CD' : 'AB';
    
    // Vérifier si toute l'équipe a fait TIRA
    const teamPlayers = this.getTeamPlayers(playerTeam);
    const allTeamTira = teamPlayers.every(p => bs.eliminated.has(p.id));
    
    if (allTeamTira) {
      // Toute l'équipe a abandonné → donner les points et passer à la phase suivante
      this.phaseResults[this.currentPhase] = {
        winner: winnerTeam,
        points,
        reason: 'TIRA'
      };
      
      this.scores[winnerTeam] += points;
      
      return this.moveToNextPhase();
    }
    
    // Passer au joueur suivant
    this.nextBettor();
    
    return { action: 'TIRA_MADE', eliminated: playerId, points, waitingFor: bs.currentBettorIndex };
  }

  handleHordago(playerId) {
    const bs = this.bettingState;
    bs.allPaso = false;
    
    bs.bets.push({ playerId, action: 'HORDAGO' });
    bs.hordago = true;
    
    // Passer à l'adversaire qui doit répondre
    this.nextBettor();
    
    return { action: 'HORDAGO_PLACED', waitingFor: bs.currentBettorIndex };
  }

  handleKanta(playerId) {
    const bs = this.bettingState;
    
    bs.bets.push({ playerId, action: 'KANTA' });
    
    // KANTA = accepter HORDAGO et révéler
    // Le gagnant de cette phase remporte la partie (40 pts)
    const phaseWinner = this.determinePhaseWinner(this.currentPhase);
    
    this.phaseResults[this.currentPhase] = {
      winner: phaseWinner.winner,
      points: this.winScore, // Victoire directe
      reason: 'HORDAGO'
    };
    
    this.scores[phaseWinner.winner] = this.winScore;
    
    return this.endGame(phaseWinner.winner);
  }

  nextBettor() {
    const bs = this.bettingState;
    
    // Ordre : A(0) → C(1) → B(2) → D(3)
    do {
      bs.currentBettorIndex = (bs.currentBettorIndex + 1) % 4;
    } while (bs.eliminated.has(bs.currentBettorIndex));
  }

  resolveAllPaso() {
    // Tout le monde a fait PASO
    const phase = this.currentPhase;
    
    if (phase === 'GRAND' || phase === 'PETIT') {
      // Grand/Petit : 1 pt au gagnant (IDUKI virtuel)
      const phaseWinner = this.determinePhaseWinner(phase);
      
      this.phaseResults[phase] = {
        winner: phaseWinner.winner,
        points: 1,
        reason: 'ALL_PASO'
      };
      
      this.scores[phaseWinner.winner] += 1;
      
    } else {
      // Paires/Jeu/PUNTUAK : 0 pt mais prime en fin de manche
      const phaseWinner = this.determinePhaseWinner(phase);
      
      this.phaseResults[phase] = {
        winner: phaseWinner.winner,
        points: 0,
        reason: 'ALL_PASO_PRIME_ONLY'
      };
      
      this.phaseWinners[phase] = phaseWinner.winner;
      
      // Calculer la prime pour plus tard
      const prime = this.calculatePrime(phase, phaseWinner.details);
      if (prime > 0) {
        this.pendingPrimes[phase] = {
          team: phaseWinner.winner,
          points: prime
        };
      }
    }
    
    return this.moveToNextPhase();
  }

  resolvePhase() {
    // IDUKI = révéler et comparer
    const phase = this.currentPhase;
    const bs = this.bettingState;
    
    const phaseWinner = this.determinePhaseWinner(phase);
    
    // Calculer les points : baseStake (1) + raiseCount
    const points = bs.baseStake + bs.raiseCount;
    
    this.phaseResults[phase] = {
      winner: phaseWinner.winner,
      points,
      reason: 'IDUKI',
      details: phaseWinner.details
    };
    
    this.scores[phaseWinner.winner] += points;
    this.phaseWinners[phase] = phaseWinner.winner;
    
    // Calculer la prime si applicable
    if (phase === 'PAIRES' || phase === 'JEU' || phase === 'PUNTUAK') {
      const prime = this.calculatePrime(phase, phaseWinner.details);
      if (prime > 0) {
        this.pendingPrimes[phase] = {
          team: phaseWinner.winner,
          points: prime
        };
      }
    }
    
    return this.moveToNextPhase();
  }

  moveToNextPhase() {
    this.currentPhaseIndex++;
    
    // Vérifier si on doit passer à PUNTUAK
    if (this.currentPhaseIndex === this.phases.indexOf('JEU') + 1) {
      // Vérifier si quelqu'un a le JEU
      const teamAJeu = this.calculateJeu(this.getTeamCards('AB'));
      const teamBJeu = this.calculateJeu(this.getTeamCards('CD'));
      
      if (!teamAJeu.hasJeu && !teamBJeu.hasJeu) {
        // Personne n'a le JEU → PUNTUAK
        this.phases[this.currentPhaseIndex] = 'PUNTUAK';
        this.startBettingPhase('PUNTUAK');
        return { nextPhase: 'PUNTUAK' };
      }
    }
    
    if (this.currentPhaseIndex >= this.phases.length) {
      return this.endRound();
    }

    const nextPhase = this.phases[this.currentPhaseIndex];
    this.startBettingPhase(nextPhase);
    
    return { nextPhase };
  }

  // ==================== DÉTERMINATION DES GAGNANTS ====================
  
  determinePhaseWinner(phase) {
    const teamACards = this.getTeamCards('AB');
    const teamBCards = this.getTeamCards('CD');

    let result = 0;
    let details = {};

    switch(phase) {
      case 'GRAND':
        const bestA_Grand = Math.max(...teamACards.map(c => c.grandValue));
        const bestB_Grand = Math.max(...teamBCards.map(c => c.grandValue));
        result = bestA_Grand > bestB_Grand ? 1 : (bestA_Grand < bestB_Grand ? -1 : 0);
        details = { teamAB: bestA_Grand, teamCD: bestB_Grand };
        break;

      case 'PETIT':
        const bestA_Petit = Math.min(...teamACards.map(c => c.petitValue));
        const bestB_Petit = Math.min(...teamBCards.map(c => c.petitValue));
        result = bestA_Petit < bestB_Petit ? 1 : (bestA_Petit > bestB_Petit ? -1 : 0);
        details = { teamAB: bestA_Petit, teamCD: bestB_Petit };
        break;

      case 'PAIRES':
        const pairesA = this.detectBestPaires(teamACards);
        const pairesB = this.detectBestPaires(teamBCards);
        result = pairesA.value > pairesB.value ? 1 : (pairesA.value < pairesB.value ? -1 : 0);
        details = { teamAB: pairesA, teamCD: pairesB };
        break;

      case 'JEU':
        const jeuA = this.calculateJeu(teamACards);
        const jeuB = this.calculateJeu(teamBCards);
        
        if (jeuA.hasJeu && !jeuB.hasJeu) result = 1;
        else if (!jeuA.hasJeu && jeuB.hasJeu) result = -1;
        else if (jeuA.hasJeu && jeuB.hasJeu) {
          // Comparer les totaux selon l'ordre : 31 > 32 > 40 > 39 > 38... > 33
          result = this.compareJeu(jeuA.total, jeuB.total);
        }
        details = { teamAB: jeuA, teamCD: jeuB };
        break;

      case 'PUNTUAK':
        const totalA = teamACards.reduce((s, c) => s + c.gameValue, 0);
        const totalB = teamBCards.reduce((s, c) => s + c.gameValue, 0);
        result = totalA > totalB ? 1 : (totalA < totalB ? -1 : 0);
        details = { teamAB: totalA, teamCD: totalB };
        break;
    }

    // En cas d'égalité : la Mano gagne
    if (result === 0) {
      const manoTeam = this.manoPosition % 2 === 0 ? 'AB' : 'CD';
      result = manoTeam === 'AB' ? 1 : -1;
      details.tieBreaker = 'MANO';
    }

    const winner = result > 0 ? 'AB' : 'CD';
    
    return { winner, details };
  }

  detectBestPaires(cards) {
    // Cartes par joueur (4 par joueur, 8 total pour l'équipe)
    // On cherche les paires dans chaque main de 4 cartes
    
    const player1Cards = cards.slice(0, 4);
    const player2Cards = cards.slice(4, 8);
    
    const paires1 = this.detectPaires(player1Cards);
    const paires2 = this.detectPaires(player2Cards);
    
    // Retourner la meilleure
    return paires1.value > paires2.value ? paires1 : paires2;
  }

  detectPaires(cards) {
    const valueCounts = {};
    cards.forEach(card => {
      const val = card.name;
      valueCounts[val] = (valueCounts[val] || 0) + 1;
    });

    const counts = Object.values(valueCounts).sort((a, b) => b - a);
    
    // Double paire (2+2) ou 4 identiques (compté comme double paire)
    if (counts[0] === 4 || (counts[0] === 2 && counts[1] === 2)) {
      return { type: 'DOUBLE_PAIRE', value: 3, name: 'Double paire' };
    }
    
    // Brelan (3 identiques)
    if (counts[0] === 3) {
      return { type: 'BRELAN', value: 2, name: 'Brelan' };
    }
    
    // Paire simple
    if (counts[0] === 2) {
      return { type: 'PAIRE', value: 1, name: 'Paire' };
    }
    
    return { type: 'NONE', value: 0, name: 'Rien' };
  }

  calculateJeu(cards) {
    // Cartes par joueur
    const player1Cards = cards.slice(0, 4);
    const player2Cards = cards.slice(4, 8);
    
    const total1 = player1Cards.reduce((sum, card) => sum + card.gameValue, 0);
    const total2 = player2Cards.reduce((sum, card) => sum + card.gameValue, 0);
    
    const bestTotal = Math.max(total1, total2);
    
    return {
      total: bestTotal,
      hasJeu: bestTotal >= 31
    };
  }

  compareJeu(a, b) {
    // Ordre : 31 > 32 > 40 > 39 > 38 > 37 > 36 > 35 > 34 > 33
    const order = [31, 32, 40, 39, 38, 37, 36, 35, 34, 33];
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return -1;
    if (indexB === -1) return 1;
    
    return indexA < indexB ? 1 : (indexA > indexB ? -1 : 0);
  }

  calculatePrime(phase, details) {
    // Primes uniquement pour Paires, Jeu, PUNTUAK
    if (phase === 'PAIRES') {
      const bestPaires = details.teamAB.value > details.teamCD.value ? details.teamAB : details.teamCD;
      return bestPaires.value; // 1, 2 ou 3
    }
    
    if (phase === 'JEU') {
      const winner = details.teamAB.hasJeu && details.teamAB.total > details.teamCD.total ? details.teamAB : details.teamCD;
      return winner.total === 31 ? 3 : 2;
    }
    
    if (phase === 'PUNTUAK') {
      return 1;
    }
    
    return 0;
  }

  // ==================== FIN DE MANCHE & PARTIE ====================
  
  endRound() {
    // Ajouter les primes
    Object.entries(this.pendingPrimes).forEach(([phase, prime]) => {
      this.scores[prime.team] += prime.points;
      
      if (this.phaseResults[phase]) {
        this.phaseResults[phase].prime = prime.points;
      }
    });
    
    this.roundHistory.push({
      timestamp: Date.now(),
      scores: { ...this.scores },
      phaseResults: { ...this.phaseResults },
      primes: { ...this.pendingPrimes }
    });
    
    // Vérifier victoire
    if (this.scores.AB >= this.winScore || this.scores.CD >= this.winScore) {
      const winner = this.scores.AB >= this.winScore ? 'AB' : 'CD';
      return this.endGame(winner);
    }
    
    // Nouvelle manche
    this.manoPosition = (this.manoPosition + 1) % 4;
    this.phaseResults = {};
    this.phaseWinners = {};
    this.pendingPrimes = {};
    this.currentPhaseIndex = 0;
    this.phases = ['GRAND', 'PETIT', 'PAIRES', 'JEU'];
    
    this.state = 'ROUND_ENDED';
    
    return { 
      action: 'ROUND_END',
      scores: this.scores,
      phaseResults: this.phaseResults,
      nextRound: true
    };
  }

  endGame(winner) {
    const duration = Date.now() - this.gameStartTime;
    
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
  }

  // ==================== UTILITAIRES ====================
  
  getPlayerTeam(playerId) {
    // 0=A, 2=B → Équipe AB
    // 1=C, 3=D → Équipe CD
    return (playerId === 0 || playerId === 2) ? 'AB' : 'CD';
  }

  getTeamPlayers(team) {
    if (team === 'AB') {
      return [this.players[0], this.players[2]];
    } else {
      return [this.players[1], this.players[3]];
    }
  }

  getTeamCards(team) {
    if (team === 'AB') {
      return [...this.playerCards[0], ...this.playerCards[2]];
    } else {
      return [...this.playerCards[1], ...this.playerCards[3]];
    }
  }

  getGameState(forPlayerId) {
    const player = this.players.find(p => p.id === forPlayerId);
    const team = this.getPlayerTeam(forPlayerId);
    
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
        AB: this.teams.A.map(p => ({ id: p.id, name: p.name })),
        CD: this.teams.B.map(p => ({ id: p.id, name: p.name }))
      },
      myCards: this.playerCards[forPlayerId] || [],
      myPosition: forPlayerId,
      myTeam: team,
      manoPosition: this.manoPosition,
      isMano: forPlayerId === this.manoPosition,
      scores: this.scores,
      winScore: this.winScore,
      musVotes: this.musVotes,
      bettingState: this.bettingState,
      phaseResults: this.phaseResults,
      pendingPrimes: this.pendingPrimes,
      waitingForMus: this.state === 'MUS_DECISION' && !this.musVotes[forPlayerId],
      needsDiscard: this.state === 'MUS_DISCARD' && this.playerDiscards[forPlayerId]?.length === 0,
      currentBettor: this.bettingState.currentBettorIndex,
      isMyTurn: this.bettingState.currentBettorIndex === forPlayerId,
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

  socket.on('MUS_VOTE', ({ vote }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.state !== 'MUS_DECISION') {
      socket.emit('ERROR', { message: 'Action impossible' });
      return;
    }

    const result = room.handleMusVote(playerData.playerId, vote);

    if (result.action === 'MUS_ACCEPTED') {
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

  socket.on('MUS_DISCARD', ({ cardIndices }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room || room.state !== 'MUS_DISCARD') {
      socket.emit('ERROR', { message: 'Action impossible' });
      return;
    }

    const result = room.handleMusDiscard(playerData.playerId, cardIndices);

    if (!result.success) {
      socket.emit('ERROR', { message: result.error });
      return;
    }

    room.players.forEach(player => {
      io.to(player.socketId).emit('GAME_STATE_UPDATE', {
        gameState: room.getGameState(player.id)
      });
    });

    if (result.action === 'RESTART_MUS_VOTE') {
      room.players.forEach(player => {
        io.to(player.socketId).emit('MUS_RESTARTED', {
          gameState: room.getGameState(player.id)
        });
      });
    }
  });

  socket.on('PLACE_BET', ({ action, value }) => {
    const playerData = playerSockets.get(socket.id);
    if (!playerData) return;

    const room = rooms.get(playerData.roomId);
    if (!room) return;

    const result = room.handleBet(playerData.playerId, action, value);

    if (!result.success) {
      socket.emit('ERROR', { message: result.error });
      return;
    }

    console.log(`[${room.roomId}] Mise: ${action} ${value || ''}`);

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

// ==================== DÉMARRAGE ====================

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🎴 Serveur MUS BASQUE Authentique - v3.0`);
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
