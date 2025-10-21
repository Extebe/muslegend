import React, { useState, useEffect } from 'react';
import { Users, PlayCircle, LogOut, Copy, Check, Wifi, WifiOff, AlertCircle, ChevronRight, Trophy } from 'lucide-react';
import io from 'socket.io-client';

// Configuration Socket.io
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.location.origin;
let socket = null;

const MusGame = () => {
  const [screen, setScreen] = useState('HOME');
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [gameState, setGameState] = useState({
    roomId: null,
    state: 'WAITING',
    currentPhase: null,
    players: [],
    teams: { A: [], B: [] },
    myCards: [],
    myPosition: null,
    dealerPosition: 0,
    manoPosition: 0,
    isDealer: false,
    isMano: false,
    scores: { A: 0, B: 0 },
    musVotes: {},
    phaseResults: {},
    waitingForMus: false
  });

  const [phaseResult, setPhaseResult] = useState(null);

  // ==================== SOCKET.IO CONNECTION ====================
  
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
    });

    socket.on('PHASE_STARTED', (data) => {
      setGameState(prev => ({ ...prev, ...data.gameState }));
      setPhaseResult(null);
    });

    socket.on('PHASE_RESULT', (data) => {
      setPhaseResult(data);
      setGameState(prev => ({ ...prev, ...data.gameState }));
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
    setTimeout(() => setError(null), 3000);
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) return;
    setLoading(true);
    socket.emit('CREATE_ROOM', { playerName });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim() || !roomIdInput.trim()) return;
    setLoading(true);
    socket.emit('JOIN_ROOM', { roomId: roomIdInput.toUpperCase(), playerName });
  };

  const handleStartGame = () => {
    socket.emit('START_GAME');
  };

  const handleVoteMus = (wantsMus) => {
    socket.emit('MUS_VOTE', { wantsMus });
  };

  const handlePassPhase = () => {
    socket.emit('PASS_PHASE');
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
      teams: { A: [], B: [] },
      myCards: [],
      myPosition: null,
      dealerPosition: 0,
      manoPosition: 0,
      isDealer: false,
      isMano: false,
      scores: { A: 0, B: 0 },
      musVotes: {},
      phaseResults: {},
      waitingForMus: false
    });
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(gameState.roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ==================== COMPONENTS ====================

  const Card = ({ suit, value }) => {
    const isRed = suit === '♥' || suit === '♦';
    return (
      <div className={`bg-white rounded-lg shadow-xl p-4 w-20 h-28 flex flex-col items-center justify-between border-2 transition-transform hover:scale-105 ${isRed ? 'border-red-600' : 'border-gray-800'}`}>
        <div className={`text-2xl font-bold ${isRed ? 'text-red-600' : 'text-gray-800'}`}>
          {value}
        </div>
        <div className={`text-4xl ${isRed ? 'text-red-600' : 'text-gray-800'}`}>
          {suit}
        </div>
        <div className={`text-2xl font-bold ${isRed ? 'text-red-600' : 'text-gray-800'}`}>
          {value}
        </div>
      </div>
    );
  };

  const PlayerSlot = ({ player, position, isMe, team }) => {
    const positions = ['bottom', 'left', 'top', 'right'];
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

    const teamColor = team === 'A' ? 'bg-blue-600' : 'bg-red-600';

    return (
      <div className={`absolute ${getPositionStyles()} flex flex-col items-center gap-2 z-10`}>
        <div className={`${teamColor} text-white px-4 py-2 rounded-lg shadow-lg ${isMe ? 'ring-4 ring-yellow-400' : ''}`}>
          <div className="font-bold">{player?.name || 'En attente...'}</div>
          <div className="text-xs">Équipe {team}</div>
        </div>
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

  const PhaseResultModal = () => {
    if (!phaseResult) return null;

    const winner = phaseResult.result?.winner;
    const winnerTeam = winner === 'A' ? 'Équipe A' : 'Équipe B';
    const winnerColor = winner === 'A' ? 'text-blue-600' : 'text-red-600';

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl">
          <div className="text-center">
            <Trophy className={`mx-auto mb-4 ${winnerColor}`} size={64} />
            <h2 className="text-3xl font-bold mb-4">Phase {phaseResult.phase}</h2>
            <div className={`text-2xl font-bold mb-6 ${winnerColor}`}>
              🏆 {winnerTeam} gagne !
            </div>
            
            {phaseResult.result?.details && (
              <div className="bg-gray-100 rounded-lg p-4 mb-6">
                <div className="text-sm text-gray-600">Détails</div>
                <pre className="text-xs mt-2">{JSON.stringify(phaseResult.result.details, null, 2)}</pre>
              </div>
            )}

            <div className="flex gap-2 justify-center mb-4">
              <div className="bg-blue-100 px-4 py-2 rounded-lg">
                <div className="text-xs text-blue-600">Équipe A</div>
                <div className="text-2xl font-bold text-blue-600">{gameState.scores.A}</div>
              </div>
              <div className="bg-red-100 px-4 py-2 rounded-lg">
                <div className="text-xs text-red-600">Équipe B</div>
                <div className="text-2xl font-bold text-red-600">{gameState.scores.B}</div>
              </div>
            </div>

            {phaseResult.nextPhase !== 'FINISHED' ? (
              <button
                onClick={handlePassPhase}
                className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 flex items-center justify-center gap-2"
              >
                Phase suivante: {phaseResult.nextPhase}
                <ChevronRight size={20} />
              </button>
            ) : (
              <div className="text-lg font-semibold text-gray-600">
                Manche terminée !
              </div>
            )}
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
          <p className="text-center text-gray-600 mb-2">Sprint 2 - Game Logic</p>
          <p className="text-center text-sm text-gray-500 mb-8">Phases de jeu complètes</p>
          
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
            <h2 className="text-3xl font-bold text-green-800">Salle de jeu</h2>
            <button onClick={handleLeaveRoom} className="text-red-600 hover:text-red-700 flex items-center gap-2">
              <LogOut size={20} /> Quitter
            </button>
          </div>

          <div className="bg-gradient-to-r from-green-100 to-green-50 rounded-lg p-4 mb-6 flex items-center justify-between border-2 border-green-200">
            <div>
              <div className="text-sm text-gray-600 font-medium">Code de la salle</div>
              <div className="text-3xl font-mono font-bold text-green-800">{gameState.roomId}</div>
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
                <div className="text-center font-bold text-blue-800 mb-3">⚔️ Équipe A</div>
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
                <div className="text-center font-bold text-red-800 mb-3">🛡️ Équipe B</div>
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
    const myTeam = gameState.myPosition !== null ? (gameState.myPosition % 2 === 0 ? 'A' : 'B') : null;

    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 relative">
        <ErrorNotification />
        <PhaseResultModal />

        {/* Table */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-[800px] h-[600px] bg-green-800 rounded-full shadow-2xl border-8 border-yellow-900">
            
            {gameState.players.map((player, idx) => {
              const team = idx % 2 === 0 ? 'A' : 'B';
              return <PlayerSlot key={player.id} player={player} position={idx} isMe={idx === gameState.myPosition} team={team} />;
            })}

            {/* Centre */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10">
              <div className="bg-yellow-900 text-yellow-100 px-6 py-3 rounded-lg shadow-lg">
                <div className="text-sm font-medium">Phase actuelle</div>
                <div className="text-3xl font-bold mt-1">
                  {gameState.currentPhase || gameState.state}
                </div>
              </div>

              <div className="mt-4 flex gap-4 justify-center">
                <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
                  <div className="text-xs">Équipe A</div>
                  <div className="text-2xl font-bold">{gameState.scores.A}</div>
                </div>
                <div className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg">
                  <div className="text-xs">Équipe B</div>
                  <div className="text-2xl font-bold">{gameState.scores.B}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cartes */}
        {gameState.myCards.length > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-4 z-20">
            {gameState.myCards.map((card, idx) => (
              <Card key={idx} suit={card.suit} value={card.name} />
            ))}
          </div>
        )}

        {/* Boutons MUS */}
        {gameState.waitingForMus && (
          <div className="fixed bottom-40 left-1/2 -translate-x-1/2 flex gap-4 z-20">
            <button onClick={() => handleVoteMus(false)} className="bg-red-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-red-700 shadow-2xl">
              IDOKI
            </button>
            <button onClick={() => handleVoteMus(true)} className="bg-green-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-green-700 shadow-2xl">
              MUS
            </button>
          </div>
        )}

        {/* Bouton Passer Phase */}
        {gameState.currentPhase && !phaseResult && !gameState.waitingForMus && (
          <div className="fixed bottom-40 left-1/2 -translate-x-1/2 z-20">
            <button onClick={handlePassPhase} className="bg-orange-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-orange-700 shadow-2xl">
              Passer la phase {gameState.currentPhase}
            </button>
          </div>
        )}

        <button onClick={handleLeaveRoom} className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2 z-30">
          <LogOut size={18} /> Quitter
        </button>

        <div className="fixed top-4 left-4 bg-white/90 backdrop-blur rounded-lg px-4 py-2 text-sm shadow-lg z-30">
          <div className="flex items-center gap-2">
            {connected ? <Wifi size={16} className="text-green-600" /> : <WifiOff size={16} className="text-red-600" />}
            <span className="font-medium">{connected ? 'Connecté' : 'Déconnecté'}</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">Salle: {gameState.roomId}</div>
          <div className="text-xs text-gray-600">Équipe: {myTeam}</div>
        </div>
      </div>
    );
  }

  return null;
};

export default MusGame;
