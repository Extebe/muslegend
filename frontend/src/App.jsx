import React, { useState, useEffect } from 'react';
import { Users, PlayCircle, LogOut, Copy, Check, Wifi, WifiOff, AlertCircle, ChevronRight, Trophy, Award } from 'lucide-react';
import io from 'socket.io-client';

const SOCKET_URL = window.location.origin;
let socket = null;

const MusGame = () => {
  const [screen, setScreen] = useState('HOME');
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [winScore, setWinScore] = useState(40);
  
  const [selectedCards, setSelectedCards] = useState([]);
  const [gehiagoAmount, setGehiagoAmount] = useState(2);
  
  const [gameState, setGameState] = useState({
    roomId: null,
    state: 'WAITING',
    currentPhase: null,
    players: [],
    teams: { AB: [], CD: [] },
    myCards: [],
    myPosition: null,
    myTeam: null,
    manoPosition: 0,
    isMano: false,
    scores: { AB: 0, CD: 0 },
    winScore: 40,
    musVotes: {},
    bettingState: {
      currentBettorIndex: 0,
      bets: [],
      baseStake: 0,
      raiseCount: 0,
      hordago: false,
      eliminated: new Set()
    },
    phaseResults: {},
    pendingPrimes: {},
    waitingForMus: false,
    needsDiscard: false,
    currentBettor: 0,
    isMyTurn: false,
    roundHistory: []
  });

  const [phaseResult, setPhaseResult] = useState(null);
  const [gameEndModal, setGameEndModal] = useState(null);

  // ==================== UTILITAIRES ====================

  // Conversion symboles cartes espagnoles
  const getSuitDisplay = (suit) => {
    const suits = {
      '♦': { symbol: '🟡', name: 'Oros', color: 'text-yellow-600' },
      '♥': { symbol: '🍷', name: 'Copas', color: 'text-red-600' },
      '♠': { symbol: '⚔️', name: 'Espadas', color: 'text-gray-800' },
      '♣': { symbol: '🪵', name: 'Bastos', color: 'text-amber-800' }
    };
    return suits[suit] || { symbol: suit, name: suit, color: 'text-gray-800' };
  };

  // Traduction des états de jeu
  const getStateDisplay = (state) => {
    const states = {
      'WAITING': 'En attente de joueurs',
      'LOBBY': 'Salle d\'attente',
      'MUS_DECISION': 'Vote MUS',
      'MUS_DISCARD': 'Jetée de cartes',
      'BETTING_GRAND': 'Mises - Grand',
      'BETTING_PETIT': 'Mises - Petit',
      'BETTING_PAIRES': 'Mises - Paires',
      'BETTING_JEU': 'Mises - Jeu',
      'BETTING_PUNTUAK': 'Mises - Puntuak',
      'ROUND_ENDED': 'Fin de manche',
      'GAME_ENDED': 'Partie terminée'
    };
    return states[state] || state;
  };

  // Traduction des phases
  const getPhaseDisplay = (phase) => {
    const phases = {
      'GRAND': 'Grand',
      'PETIT': 'Petit',
      'PAIRES': 'Paires',
      'JEU': 'Jeu',
      'PUNTUAK': 'Puntuak'
    };
    return phases[phase] || phase;
  };

  // ==================== SOCKET.IO ====================
  
  useEffect(() => {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true
    });

    socket.on('connect', () => {
      console.log('✅ Connecté');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('❌ Déconnecté');
      setConnected(false);
    });

    socket.on('ERROR', (data) => {
      showError(data.message);
    });

    socket.on('ROOM_CREATED', (data) => {
      setGameState(data.gameState);
      setScreen('LOBBY');
      setLoading(false);
    });

    socket.on('GAME_STATE_UPDATE', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
    });

    socket.on('TEAMS_ASSIGNED', () => {
      console.log('Équipes attribuées');
    });

    socket.on('GAME_STARTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setScreen('GAME');
    });

    socket.on('MUS_ACCEPTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setSelectedCards([]);
    });

    socket.on('MUS_RESTARTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setSelectedCards([]);
    });

    socket.on('BETTING_STARTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setPhaseResult(null);
    });

    socket.on('BET_UPDATE', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      
      if (data.betResult.action === 'ROUND_END' || data.betResult.action === 'GAME_END') {
        setPhaseResult(data.betResult);
      }
    });

    socket.on('ROUND_ENDED', (data) => {
      setPhaseResult(data);
    });

    socket.on('GAME_ENDED', (data) => {
      setGameEndModal(data);
    });

    socket.on('NEW_ROUND_STARTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setPhaseResult(null);
      setSelectedCards([]);
    });

    socket.on('PLAYER_DISCONNECTED', (data) => {
      showError(`${data.playerName} s'est déconnecté`);
    });

    socket.on('GAME_CANCELLED', (data) => {
      showError(data.message);
      setScreen('HOME');
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  // ==================== ACTIONS ====================

  const showError = (message) => {
    setError(message);
    setTimeout(() => setError(null), 4000);
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) return;
    setLoading(true);
    socket.emit('CREATE_ROOM', { 
      playerName,
      config: { winScore }
    });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim() || !roomIdInput.trim()) return;
    setLoading(true);
    socket.emit('JOIN_ROOM', { roomId: roomIdInput.toUpperCase(), playerName });
  };

  const handleStartGame = () => {
    socket.emit('START_GAME');
  };

  const handleMusVote = (vote) => {
    socket.emit('MUS_VOTE', { vote });
  };

  const handleMusDiscard = () => {
    if (selectedCards.length < 1 || selectedCards.length > 4) {
      showError('Sélectionnez entre 1 et 4 cartes');
      return;
    }
    socket.emit('MUS_DISCARD', { cardIndices: selectedCards });
    setSelectedCards([]);
  };

  const handlePlaceBet = (action, value = null) => {
    socket.emit('PLACE_BET', { action, value });
  };

  const handleStartNewRound = () => {
    socket.emit('START_NEW_ROUND');
    setPhaseResult(null);
  };

  const handleLeaveRoom = () => {
    socket.emit('LEAVE_ROOM');
    setScreen('HOME');
    setGameState({
      roomId: null,
      state: 'WAITING',
      currentPhase: null,
      players: [],
      teams: { AB: [], CD: [] },
      myCards: [],
      myPosition: null,
      manoPosition: 0,
      isMano: false,
      scores: { AB: 0, CD: 0 },
      musVotes: {},
      waitingForMus: false,
      needsDiscard: false
    });
    setSelectedCards([]);
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(gameState.roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleCardSelection = (index) => {
    if (selectedCards.includes(index)) {
      setSelectedCards(selectedCards.filter(i => i !== index));
    } else {
      if (selectedCards.length < 4) {
        setSelectedCards([...selectedCards, index]);
      }
    }
  };

  // ==================== COMPONENTS ====================

  const Card = ({ suit, value, highlighted = false, selectable = false, selected = false, onClick }) => {
    const suitDisplay = getSuitDisplay(suit);
    
    return (
      <div 
        className={`bg-white rounded-xl shadow-2xl p-4 w-24 h-32 flex flex-col items-center justify-between border-4 transition-all ${
          highlighted ? 'ring-4 ring-yellow-400 scale-110' : ''
        } ${selected ? 'ring-4 ring-blue-500 scale-105 bg-blue-50' : ''} ${
          suitDisplay.color === 'text-red-600' ? 'border-red-500' : 'border-amber-700'
        } ${selectable ? 'hover:scale-110 cursor-pointer hover:shadow-xl' : ''}`}
        onClick={onClick}
      >
        <div className={`text-2xl font-bold ${suitDisplay.color}`}>
          {value}
        </div>
        <div className="text-5xl">
          {suitDisplay.symbol}
        </div>
        <div className={`text-xs font-semibold ${suitDisplay.color} opacity-70`}>
          {suitDisplay.name}
        </div>
      </div>
    );
  };

  const PlayerSlot = ({ player, position, isMe, team }) => {
    const positions = ['bottom', 'right', 'top', 'left'];
    const positionClass = positions[position];
    
    const getPositionStyles = () => {
      switch(positionClass) {
        case 'bottom': return 'bottom-4 left-1/2 -translate-x-1/2';
        case 'left': return 'left-4 top-1/2 -translate-y-1/2';
        case 'top': return 'top-4 left-1/2 -translate-x-1/2';
        case 'right': return 'right-4 top-1/2 -translate-y-1/2';
        default: return '';
      }
    };

    const teamColor = team === 'AB' ? 'bg-blue-600' : 'bg-red-600';
    const isBetting = gameState.currentBettor === position && gameState.state.includes('BETTING');
    const isMano = gameState.manoPosition === position;

    return (
      <div className={`absolute ${getPositionStyles()} flex flex-col items-center gap-2 z-10`}>
        <div className={`${teamColor} text-white px-4 py-2 rounded-lg shadow-lg transition-all ${
          isMe ? 'ring-4 ring-yellow-400' : ''
        } ${isBetting ? 'animate-pulse ring-4 ring-green-400' : ''}`}>
          <div className="font-bold flex items-center gap-2">
            {player?.name || 'En attente...'}
            {isMano && <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-1 rounded font-bold">MANO</span>}
          </div>
          <div className="text-xs">Équipe {team}</div>
        </div>
        {isBetting && (
          <div className="bg-green-500 text-white text-xs px-3 py-1 rounded-full animate-bounce font-bold shadow-lg">
            🎲 À son tour
          </div>
        )}
      </div>
    );
  };

  const ScoreBoard = () => (
    <div className="flex gap-4 justify-center items-center">
      <div className={`px-6 py-3 rounded-lg shadow-lg transition-all ${
        gameState.scores.AB > gameState.scores.CD ? 'bg-blue-600 scale-110' : 'bg-blue-500'
      }`}>
        <div className="text-white text-xs font-medium">Équipe A+B</div>
        <div className="text-white text-3xl font-bold">{gameState.scores.AB}</div>
        <div className="text-white text-xs opacity-75">/ {gameState.winScore}</div>
      </div>
      <div className="text-2xl text-white font-bold">VS</div>
      <div className={`px-6 py-3 rounded-lg shadow-lg transition-all ${
        gameState.scores.CD > gameState.scores.AB ? 'bg-red-600 scale-110' : 'bg-red-500'
      }`}>
        <div className="text-white text-xs font-medium">Équipe C+D</div>
        <div className="text-white text-3xl font-bold">{gameState.scores.CD}</div>
        <div className="text-white text-xs opacity-75">/ {gameState.winScore}</div>
      </div>
    </div>
  );

  const MusVotePanel = () => {
    if (!gameState.waitingForMus) return null;

    return (
      <div className="fixed bottom-40 left-1/2 -translate-x-1/2 flex gap-4 z-20">
        <button 
          onClick={() => handleMusVote('JOSTA')} 
          className="bg-red-600 text-white px-10 py-5 rounded-xl font-bold text-xl hover:bg-red-700 shadow-2xl transform hover:scale-105 transition-all"
        >
          🚫 JOSTA
          <div className="text-xs font-normal mt-1">Commencer à jouer</div>
        </button>
        <button 
          onClick={() => handleMusVote('MUS')} 
          className="bg-green-600 text-white px-10 py-5 rounded-xl font-bold text-xl hover:bg-green-700 shadow-2xl transform hover:scale-105 transition-all"
        >
          🔄 MUS
          <div className="text-xs font-normal mt-1">Changer mes cartes</div>
        </button>
      </div>
    );
  };

  const MusDiscardPanel = () => {
    if (!gameState.needsDiscard) return null;

    return (
      <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur rounded-xl p-6 shadow-2xl border-4 border-green-500">
        <div className="text-center mb-4">
          <div className="text-xl font-bold text-green-800 mb-1">🎴 Jetée de cartes</div>
          <div className="text-sm text-gray-600">Sélectionnez 1 à 4 cartes à échanger</div>
          <div className="text-lg font-bold text-green-700 mt-2">
            {selectedCards.length} carte{selectedCards.length > 1 ? 's' : ''} sélectionnée{selectedCards.length > 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={handleMusDiscard}
          disabled={selectedCards.length < 1 || selectedCards.length > 4}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all text-lg"
        >
          ✅ Jeter et piocher
        </button>
      </div>
    );
  };

  const BettingPanel = () => {
    if (!gameState.state.includes('BETTING')) return null;
    
    const bs = gameState.bettingState;
    const canBet = gameState.isMyTurn;
    const hasImido = bs.bets.some(b => b.action === 'IMIDO' || b.action === 'GEHIAGO');
    const hasHordago = bs.bets.some(b => b.action === 'HORDAGO');

    return (
      <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur rounded-xl p-6 shadow-2xl min-w-[450px] border-4 border-amber-600">
        <div className="text-center mb-4">
          <div className="text-sm text-gray-600 font-medium">Phase de mises</div>
          <div className="text-3xl font-bold text-amber-800">{getPhaseDisplay(gameState.currentPhase)}</div>
        </div>

        {bs.raiseCount > 0 && (
          <div className="mb-4 p-3 bg-orange-100 rounded-lg text-center border-2 border-orange-300">
            <div className="text-xs text-orange-700 font-semibold">Nombre de relances</div>
            <div className="text-2xl font-bold text-orange-900">{bs.raiseCount}</div>
            <div className="text-xs text-orange-600 mt-1">
              Points en jeu : {bs.baseStake + bs.raiseCount}
            </div>
          </div>
        )}

        {hasHordago && (
          <div className="mb-4 p-4 bg-red-100 rounded-lg text-center border-2 border-red-400 animate-pulse">
            <div className="text-2xl font-bold text-red-900">🔥 HORDAGO ! 🔥</div>
            <div className="text-xs text-red-700 mt-1">Mise totale - Victoire ou défaite</div>
          </div>
        )}

        {canBet ? (
          <div className="space-y-2">
            <div className="text-sm font-bold text-center mb-3 text-green-800 bg-green-100 py-2 rounded-lg">
              🎯 C'est votre tour de miser !
            </div>
            
            {!hasImido && !hasHordago ? (
              // Personne n'a encore misé
              <>
                <button
                  onClick={() => handlePlaceBet('PASO')}
                  className="w-full bg-gray-500 text-white py-3 rounded-lg font-bold hover:bg-gray-600 transition-all"
                >
                  ⏭️ PASO (Passer)
                </button>
                <button
                  onClick={() => handlePlaceBet('IMIDO')}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-all"
                >
                  💰 IMIDO (Miser 2 points)
                </button>
                <button
                  onClick={() => handlePlaceBet('HORDAGO')}
                  className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition-all"
                >
                  🔥 HORDAGO (Tout miser!)
                </button>
              </>
            ) : hasHordago ? (
              // Répondre à HORDAGO
              <>
                <button
                  onClick={() => handlePlaceBet('TIRA')}
                  className="w-full bg-gray-500 text-white py-3 rounded-lg font-bold hover:bg-gray-600 transition-all"
                >
                  🏳️ TIRA (Abandonner)
                </button>
                <button
                  onClick={() => handlePlaceBet('KANTA')}
                  className="w-full bg-red-600 text-white py-4 rounded-lg font-bold hover:bg-red-700 transition-all text-lg"
                >
                  ⚔️ KANTA (Accepter le HORDAGO!)
                </button>
              </>
            ) : (
              // Répondre à une mise normale
              <>
                <button
                  onClick={() => handlePlaceBet('TIRA')}
                  className="w-full bg-gray-500 text-white py-3 rounded-lg font-bold hover:bg-gray-600 transition-all"
                >
                  🏳️ TIRA (Abandonner)
                </button>
                <button
                  onClick={() => handlePlaceBet('IDUKI')}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition-all"
                >
                  ✅ IDUKI (Accepter et révéler)
                </button>
                <div className="text-xs text-center text-gray-700 mt-2 font-semibold">Relancer la mise :</div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={gehiagoAmount}
                    onChange={(e) => setGehiagoAmount(parseInt(e.target.value) || 1)}
                    className="w-20 px-2 py-2 border-2 border-gray-300 rounded-lg text-center font-bold text-lg"
                  />
                  <button
                    onClick={() => handlePlaceBet('GEHIAGO', gehiagoAmount)}
                    className="flex-1 bg-orange-600 text-white py-3 rounded-lg font-bold hover:bg-orange-700 transition-all"
                  >
                    ⬆️ {gehiagoAmount} GEHIAGO
                  </button>
                </div>
                <button
                  onClick={() => handlePlaceBet('HORDAGO')}
                  className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 transition-all"
                >
                  🔥 HORDAGO (Tout miser!)
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="text-center text-gray-700 py-4 bg-gray-100 rounded-lg">
            <div className="animate-pulse font-semibold">
              ⏳ En attente de {gameState.players[gameState.currentBettor]?.name}...
            </div>
          </div>
        )}
      </div>
    );
  };

  const ErrorNotification = () => {
    if (!error) return null;
    return (
      <div className="fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-slide-in">
        <AlertCircle size={20} />
        <span>{error}</span>
      </div>
    );
  };

  const RoundResultModal = () => {
    if (!phaseResult || phaseResult.action !== 'ROUND_END') return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4 shadow-2xl">
          <div className="text-center">
            <Trophy className="mx-auto mb-4 text-yellow-500" size={64} />
            <h2 className="text-3xl font-bold mb-6">🎊 Manche terminée !</h2>
            
            <ScoreBoard />

            <div className="mt-6 space-y-2">
              <div className="text-lg font-bold text-gray-700 mb-3">Résultats de la manche :</div>
              {Object.entries(gameState.phaseResults || {}).map(([phase, result]) => (
                <div key={phase} className="bg-gray-100 rounded-lg p-3 flex justify-between items-center border-2 border-gray-300">
                  <div className="text-sm font-bold text-gray-700">{getPhaseDisplay(phase)}</div>
                  <div className={`text-lg font-bold ${
                    result.winner === 'AB' ? 'text-blue-600' : 'text-red-600'
                  }`}>
                    Équipe {result.winner}: +{result.points}pts
                    {result.prime && ` (+${result.prime} 🏅)`}
                  </div>
                </div>
              ))}
            </div>

            {phaseResult.nextRound && (
              <button
                onClick={handleStartNewRound}
                className="w-full mt-6 bg-green-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-green-700 flex items-center justify-center gap-2 transition-all"
              >
                Manche suivante
                <ChevronRight size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const GameEndModal = () => {
    if (!gameEndModal) return null;

    const winnerTeam = gameEndModal.winner;
    const winnerColor = winnerTeam === 'AB' ? 'text-blue-600' : 'text-red-600';
    const winnerBg = winnerTeam === 'AB' ? 'bg-blue-600' : 'bg-red-600';

    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 max-w-3xl w-full mx-4 shadow-2xl">
          <div className="text-center">
            <Award className={`mx-auto mb-4 ${winnerColor}`} size={96} />
            <h2 className="text-4xl font-bold mb-2">🎉 Partie terminée ! 🎉</h2>
            <div className={`text-3xl font-bold mb-6 ${winnerColor}`}>
              🏆 L'équipe {winnerTeam} remporte la victoire ! 🏆
            </div>
            
            <div className="mb-6 p-4 bg-gray-100 rounded-lg">
              <div className="text-lg font-semibold mb-2">Score final</div>
              <div className="flex gap-8 justify-center">
                <div>
                  <div className="text-sm text-gray-600">Équipe AB</div>
                  <div className="text-3xl font-bold text-blue-600">{gameEndModal.finalScores.AB}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Équipe CD</div>
                  <div className="text-3xl font-bold text-red-600">{gameEndModal.finalScores.CD}</div>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleLeaveRoom}
                className="flex-1 bg-gray-600 text-white py-3 rounded-lg font-bold hover:bg-gray-700 transition-all"
              >
                Quitter
              </button>
              <button
                onClick={() => {
                  setGameEndModal(null);
                  handleStartNewRound();
                }}
                className={`flex-1 ${winnerBg} text-white py-3 rounded-lg font-bold hover:opacity-90 transition-all`}
              >
                🔄 Revanche
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==================== SCREENS ====================

  if (screen === 'HOME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <ErrorNotification />
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-4xl font-bold text-center text-green-800 mb-2">🎴 MUS BASQUE</h1>
          <p className="text-center text-gray-600 mb-2">Jeu de cartes traditionnel</p>
          <p className="text-center text-sm text-gray-500 mb-8">Cartes espagnoles • Règles authentiques • v3.1</p>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Votre pseudo</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateRoom()}
              placeholder="Entrez votre nom"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none"
              maxLength={20}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Score de victoire</label>
            <div className="flex gap-2">
              <button
                onClick={() => setWinScore(30)}
                className={`flex-1 py-2 rounded-lg font-semibold ${
                  winScore === 30 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                30 points
              </button>
              <button
                onClick={() => setWinScore(40)}
                className={`flex-1 py-2 rounded-lg font-semibold ${
                  winScore === 40 ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                40 points
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleCreateRoom}
              disabled={!playerName.trim() || loading}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : <><PlayCircle size={20} /> Créer une partie</>}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-gray-500">ou</span></div>
            </div>

            <input
              type="text"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
              placeholder="Code de la salle"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-green-500 focus:outline-none text-center text-lg font-mono"
              maxLength={6}
            />

            <button
              onClick={handleJoinRoom}
              disabled={!playerName.trim() || !roomIdInput.trim() || loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-all flex items-center justify-center gap-2"
            >
              {loading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> : <><Users size={20} /> Rejoindre</>}
            </button>
          </div>

          <div className="mt-6 text-center">
            <div className={`inline-flex items-center gap-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
              {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span className="text-sm">{connected ? 'Connecté' : 'Déconnecté'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'LOBBY') {
    const canStart = gameState.players.length === 4 && gameState.myPosition === 0;
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <ErrorNotification />
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold text-green-800">🎴 Salle de jeu</h2>
            <button onClick={handleLeaveRoom} className="text-red-600 hover:text-red-700 flex items-center gap-2">
              <LogOut size={20} /> Quitter
            </button>
          </div>

          <div className="bg-gradient-to-r from-green-100 to-green-50 rounded-lg p-4 mb-6 flex items-center justify-between border-2 border-green-200">
            <div>
              <div className="text-sm text-gray-600 font-medium">Code de la salle</div>
              <div className="text-3xl font-mono font-bold text-green-800">{gameState.roomId}</div>
              <div className="text-sm text-gray-600 mt-1">Victoire à {gameState.winScore} points</div>
            </div>
            <button onClick={handleCopyRoomId} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2">
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copié !' : 'Copier'}
            </button>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Joueurs ({gameState.players.length}/4)</h3>
              {gameState.players.length < 4 && (
                <div className="flex items-center gap-2 text-orange-600 text-sm font-medium">
                  <div className="animate-pulse w-2 h-2 bg-orange-600 rounded-full"></div>
                  En attente...
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 border-2 border-blue-200">
                <div className="text-center font-bold text-blue-800 mb-3">⚔️ Équipe A+B</div>
                <div className="space-y-2">
                  {[0, 2].map(pos => {
                    const player = gameState.players.find(p => p.position === pos);
                    return (
                      <div key={pos} className={`bg-white rounded-lg p-3 ${player ? 'border-2 border-blue-400' : 'border-2 border-dashed border-gray-300'}`}>
                        {player ? (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{player.name}</span>
                            {player.position === gameState.myPosition && <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-1 rounded font-bold">VOUS</span>}
                          </div>
                        ) : <div className="text-gray-400 text-center">En attente...</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-red-50 rounded-lg p-4 border-2 border-red-200">
                <div className="text-center font-bold text-red-800 mb-3">🛡️ Équipe C+D</div>
                <div className="space-y-2">
                  {[1, 3].map(pos => {
                    const player = gameState.players.find(p => p.position === pos);
                    return (
                      <div key={pos} className={`bg-white rounded-lg p-3 ${player ? 'border-2 border-red-400' : 'border-2 border-dashed border-gray-300'}`}>
                        {player ? (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{player.name}</span>
                            {player.position === gameState.myPosition && <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-1 rounded font-bold">VOUS</span>}
                          </div>
                        ) : <div className="text-gray-400 text-center">En attente...</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {canStart && (
            <button onClick={handleStartGame} className="w-full bg-green-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-green-700 flex items-center justify-center gap-2">
              <PlayCircle size={24} /> Lancer la partie
            </button>
          )}

          {gameState.players.length === 4 && !canStart && (
            <div className="text-center text-gray-600 py-4 bg-gray-50 rounded-lg">
              <div className="animate-pulse">En attente que l'hôte lance...</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'GAME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 relative">
        <ErrorNotification />
        <RoundResultModal />
        <GameEndModal />

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-[800px] h-[600px] bg-green-800 rounded-full shadow-2xl border-8 border-yellow-900">
            
            {gameState.players.map((player, idx) => {
              const team = (idx === 0 || idx === 2) ? 'AB' : 'CD';
              return <PlayerSlot key={player.id} player={player} position={idx} isMe={idx === gameState.myPosition} team={team} />;
            })}

            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10">
              <div className="bg-yellow-900 text-yellow-100 px-6 py-3 rounded-lg shadow-lg mb-4">
                <div className="text-sm font-medium">Phase actuelle</div>
                <div className="text-2xl font-bold mt-1">
                  {getStateDisplay(gameState.state)}
                </div>
                {gameState.currentPhase && (
                  <div className="text-lg font-semibold mt-1 text-yellow-300">
                    {getPhaseDisplay(gameState.currentPhase)}
                  </div>
                )}
              </div>

              <ScoreBoard />
            </div>
          </div>
        </div>

        {gameState.myCards.length > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-4 z-20">
            {gameState.myCards.map((card, idx) => (
              <Card 
                key={idx} 
                suit={card.suit} 
                value={card.name}
                selectable={gameState.needsDiscard}
                selected={selectedCards.includes(idx)}
                onClick={() => gameState.needsDiscard && toggleCardSelection(idx)}
              />
            ))}
          </div>
        )}

        <MusVotePanel />
        <MusDiscardPanel />
        <BettingPanel />

        <button onClick={handleLeaveRoom} className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2 z-30">
          <LogOut size={18} /> Quitter
        </button>

        <div className="fixed top-4 left-4 bg-white/90 backdrop-blur rounded-lg px-4 py-2 text-sm shadow-lg z-30">
          <div className="flex items-center gap-2">
            {connected ? <Wifi size={16} className="text-green-600" /> : <WifiOff size={16} className="text-red-600" />}
            <span className="font-medium">{connected ? 'Connecté' : 'Déconnecté'}</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">Salle: {gameState.roomId}</div>
          <div className="text-xs text-gray-600">Équipe: {gameState.myTeam}</div>
        </div>
      </div>
    );
  }

  return null;
};

export default MusGame;
