// bot-ai.js - Intelligence artificielle pour les bots du Mus Basque

class MusBot {
  constructor(playerId, playerName, room) {
    this.playerId = playerId;
    this.playerName = playerName;
    this.room = room;
    this.personality = this.generatePersonality();
  }

  generatePersonality() {
    // Chaque bot a une personnalité unique
    const personalities = ['AGRESSIF', 'PRUDENT', 'EQUILIBRE', 'BLUFFEUR'];
    return personalities[Math.floor(Math.random() * personalities.length)];
  }

  // ==================== DÉCISION MUS ====================
  
  decideMusVote() {
    const myCards = this.room.playerCards[this.playerId];
    const score = this.evaluateHandQuality(myCards);
    
    // Analyse si on a besoin du Mus
    const needsMus = score < 0.5; // Main faible
    
    if (this.personality === 'AGRESSIF') {
      // Les agressifs gardent même avec des mains moyennes
      return needsMus && Math.random() > 0.3 ? 'MUS' : 'JOSTA';
    } else if (this.personality === 'PRUDENT') {
      // Les prudents demandent souvent le Mus
      return score < 0.7 ? 'MUS' : 'JOSTA';
    } else if (this.personality === 'BLUFFEUR') {
      // Les bluffeurs sont imprévisibles
      return Math.random() > 0.5 ? 'MUS' : 'JOSTA';
    } else {
      // Équilibré
      return needsMus ? 'MUS' : 'JOSTA';
    }
  }

  // ==================== DÉCISION DÉFAUSSE ====================
  
  decideDiscard() {
    const myCards = this.room.playerCards[this.playerId];
    const cardsToDiscard = [];
    
    // Évaluer chaque carte
    const cardScores = myCards.map((card, idx) => ({
      idx,
      card,
      score: this.evaluateCardValue(card, myCards)
    }));
    
    // Trier par score (les pires en premier)
    cardScores.sort((a, b) => a.score - b.score);
    
    // Défausser les 1-3 cartes les plus faibles
    const discardCount = Math.floor(Math.random() * 3) + 1; // 1 à 3 cartes
    
    for (let i = 0; i < discardCount && i < cardScores.length; i++) {
      cardsToDiscard.push(cardScores[i].idx);
    }
    
    return cardsToDiscard;
  }

  evaluateCardValue(card, allCards) {
    let score = 0;
    
    // Valeur pour GRAND (cartes hautes = mieux)
    score += card.grandValue * 0.3;
    
    // Valeur pour PETIT (cartes basses = mieux)
    score += (11 - card.petitValue) * 0.2;
    
    // Valeur pour JEU
    score += card.gameValue * 0.3;
    
    // Bonus si fait partie d'une paire
    const sameValue = allCards.filter(c => c.name === card.name).length;
    if (sameValue >= 2) {
      score += 20 * sameValue; // Garder les paires !
    }
    
    return score;
  }

  // ==================== DÉCISION PARIS ====================
  
  decideBet(phase) {
    const bs = this.room.bettingState;
    const myCards = this.room.playerCards[this.playerId];
    const myTeam = this.room.getPlayerTeam(this.playerId);
    
    // Évaluer la force de notre main pour cette phase
    const handStrength = this.evaluatePhaseStrength(phase, myCards);
    
    // Vérifier si on a déjà misé
    const hasBets = bs.bets.length > 0 && bs.bets.some(b => b.action !== 'PASO');
    const lastBet = bs.bets[bs.bets.length - 1];
    
    // Si pas encore de mise
    if (!hasBets) {
      return this.decideInitialBet(handStrength);
    }
    
    // Si quelqu'un a fait IMIDO/GEHIAGO/HORDAGO
    if (lastBet && ['IMIDO', 'GEHIAGO', 'HORDAGO'].includes(lastBet.action)) {
      return this.decideResponse(handStrength, lastBet);
    }
    
    // Par défaut, PASO
    return { action: 'PASO' };
  }

  decideInitialBet(handStrength) {
    const aggressiveness = this.getAggressiveness();
    
    if (handStrength > 0.8 && Math.random() < aggressiveness * 0.3) {
      // Main très forte → HORDAGO rare
      return { action: 'HORDAGO' };
    }
    
    if (handStrength > 0.65 && Math.random() < aggressiveness) {
      // Main forte → IMIDO
      return { action: 'IMIDO' };
    }
    
    if (handStrength > 0.4) {
      // Main moyenne → PASO (attendre de voir)
      return { action: 'PASO' };
    }
    
    // Main faible → PASO
    return { action: 'PASO' };
  }

  decideResponse(handStrength, lastBet) {
    const aggressiveness = this.getAggressiveness();
    const bs = this.room.bettingState;
    
    if (lastBet.action === 'HORDAGO') {
      // Répondre à HORDAGO
      if (handStrength > 0.75) {
        return { action: 'KANTA' }; // Accepter si très forte
      } else {
        return { action: 'TIRA' }; // Se coucher sinon
      }
    }
    
    if (lastBet.action === 'GEHIAGO') {
      // Répondre à une relance
      if (handStrength > 0.7 && bs.raiseCount < 3) {
        // Contre-relancer
        const raiseAmount = Math.floor(Math.random() * 2) + 1;
        return { action: 'GEHIAGO', value: raiseAmount };
      } else if (handStrength > 0.5) {
        // Suivre
        return { action: 'IDUKI' };
      } else {
        // Se coucher
        return { action: 'TIRA' };
      }
    }
    
    if (lastBet.action === 'IMIDO') {
      // Répondre à IMIDO
      if (handStrength > 0.75 && Math.random() < aggressiveness) {
        // Relancer
        const raiseAmount = Math.floor(Math.random() * 2) + 1;
        return { action: 'GEHIAGO', value: raiseAmount };
      } else if (handStrength > 0.6 && Math.random() < aggressiveness * 0.5) {
        // HORDAGO occasionnel si très forte
        return { action: 'HORDAGO' };
      } else if (handStrength > 0.4) {
        // Suivre
        return { action: 'IDUKI' };
      } else {
        // Se coucher
        return { action: 'TIRA' };
      }
    }
    
    return { action: 'PASO' };
  }

  // ==================== ÉVALUATIONS ====================
  
  evaluateHandQuality(cards) {
    let score = 0;
    
    // GRAND
    const maxGrand = Math.max(...cards.map(c => c.grandValue));
    score += (maxGrand / 10) * 0.25;
    
    // PETIT
    const minPetit = Math.min(...cards.map(c => c.petitValue));
    score += ((11 - minPetit) / 10) * 0.25;
    
    // PAIRES
    const paires = this.room.detectPaires(cards);
    score += (paires.value / 3) * 0.25;
    
    // JEU
    const jeu = cards.reduce((sum, card) => sum + card.gameValue, 0);
    if (jeu >= 31) {
      score += 0.25;
    } else {
      score += (jeu / 40) * 0.15;
    }
    
    return Math.min(score, 1);
  }

  evaluatePhaseStrength(phase, cards) {
    const partnerCards = this.getPartnerCards();
    const teamCards = [...cards, ...partnerCards];
    const opponentTeam = this.room.getPlayerTeam(this.playerId) === 'AB' ? 'CD' : 'AB';
    
    switch (phase) {
      case 'GRAND': {
        const myBest = Math.max(...teamCards.map(c => c.grandValue));
        // Estimation: R=10 est excellent, As=1 est nul
        return myBest / 10;
      }
      
      case 'PETIT': {
        const myBest = Math.min(...teamCards.map(c => c.petitValue));
        // Estimation: As=1 est excellent, R=10 est nul
        return (11 - myBest) / 10;
      }
      
      case 'PAIRES': {
        const myPaires = this.room.detectBestPaires(teamCards);
        // 0 = rien, 1 = paire, 2 = brelan, 3 = double paire
        return myPaires.value / 3;
      }
      
      case 'JEU':
      case 'PUNTUAK': {
        const myJeu = this.room.calculateJeu(teamCards);
        if (!myJeu.hasJeu) return 0.3; // Pas de jeu = faible
        
        // 31 est le meilleur, 40 est aussi très bon
        const jeuOrder = [31, 32, 40, 39, 38, 37, 36, 35, 34, 33];
        const myIndex = jeuOrder.indexOf(myJeu.total);
        
        if (myIndex === -1) return 0.3;
        return 1 - (myIndex / jeuOrder.length);
      }
      
      default:
        return 0.5;
    }
  }

  getPartnerCards() {
    const myTeam = this.room.getPlayerTeam(this.playerId);
    const partners = myTeam === 'AB' ? [0, 2] : [1, 3];
    const partnerId = partners.find(id => id !== this.playerId);
    return this.room.playerCards[partnerId] || [];
  }

  getAggressiveness() {
    switch (this.personality) {
      case 'AGRESSIF': return 0.8;
      case 'PRUDENT': return 0.3;
      case 'BLUFFEUR': return 0.9;
      case 'EQUILIBRE': return 0.5;
      default: return 0.5;
    }
  }
}

// ==================== GESTIONNAIRE DE BOTS ====================

class BotManager {
  constructor(room) {
    this.room = room;
    this.bots = new Map();
    this.botDelay = { min: 800, max: 2000 }; // Délai en ms pour simuler la réflexion
  }

  addBot(playerId, playerName) {
    const bot = new MusBot(playerId, playerName, this.room);
    this.bots.set(playerId, bot);
    console.log(`[BOT] ${playerName} ajouté avec personnalité: ${bot.personality}`);
  }

  removeBot(playerId) {
    this.bots.delete(playerId);
  }

  isBot(playerId) {
    return this.bots.has(playerId);
  }

  async botMusVote(playerId, callback) {
    const bot = this.bots.get(playerId);
    if (!bot) return;

    await this.delay();
    
    const vote = bot.decideMusVote();
    callback(playerId, vote);
  }

  async botDiscard(playerId, callback) {
    const bot = this.bots.get(playerId);
    if (!bot) return;

    await this.delay();
    
    const cardIndices = bot.decideDiscard();
    callback(playerId, cardIndices);
  }

  async botBet(playerId, callback) {
    const bot = this.bots.get(playerId);
    if (!bot) return;

    await this.delay();
    
    const phase = this.room.currentPhase;
    const decision = bot.decideBet(phase);
    
    console.log(`[BOT] ${bot.playerName} décide: ${decision.action} ${decision.value || ''}`);
    callback(playerId, decision.action, decision.value);
  }

  delay() {
    const ms = Math.random() * (this.botDelay.max - this.botDelay.min) + this.botDelay.min;
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getAllBotIds() {
    return Array.from(this.bots.keys());
  }
}

module.exports = { MusBot, BotManager };
