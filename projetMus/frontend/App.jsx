import React, { useState } from 'react';
import { Users, PlayCircle, LogOut, Copy, Check, Wifi, WifiOff, AlertCircle } from 'lucide-react';

// Hook personnalisï¿½ simulï¿½ (ï¿½ remplacer par useGame.js en production)
const useGameSimulation = () => {
  const [gameState, setGameState] = useState({
    roomId: null,
    state: 'WAITING',
    players: [],
    teams: { A: [], B: [] },
    myCards: [],
    myPosition: null,
    dealerPosition: 0,
    isDealer: false,
    currentTurn: 0,
    scores: { A: 0, B: 0 },
    musVotes: {},
    waitingForMus: false
  });

  const [connected, setConnected] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const createRoom = async (playerName) => {
    setLoading(true);
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    setTimeout(() => {
      setGameState({
        ...gameState,
        roomId,
        state: 'LOBBY',
        players: [{ id: 0, name: playerName, position: 0, connected: true }],
        myPosition: 0
      });
      setLoading(false);
    }, 500);
    
    return { success: true, roomId };
  };

  const joinRoom = async (roomId, playerName) => {
    setLoading(true);
    const position = gameState.players.length;
    
    setTimeout(() => {
      const newPlayers = [...gameState.players, { id: position, name: playerName, position, connected: true }];
      setGameState({
        ...gameState,
        roomId,
        players: newPlayers,
        myPosition: position,
        state: newPlayers.length === 4 ? 'LOBBY' : 'WAITING'
      });
      
      if (newPlayers.length === 4) {
        assignTeams(newPlayers);
      }
      setLoading(false);
    }, 500);
    
    return { success: true };
  };

  const assignTeams = (players) => {
    setGameState(prev => ({
      ...prev,
      teams: {
        A: [players[0], players[2]],
        B: [players[1], players[3]]
      }
    }));
  };

  const startGame = () => {
    setTimeout(() => {
      distributeCards();
    }, 500);
  };

  const distributeCards = () => {
    const suits = ['?', '<3', '?', '?'];
    const values = ['As', '2', '3', '4', '5', '6', '7', 'V', 'C', 'R'];
    const cards = [];
    
    for (let i = 0; i < 4; i++) {
      cards.push({
        suit: suits[Math.floor(Math.random() * suits.length)],
        value: values[Math.floor(Math.random() * values.length)]
      });
    }
    
    setGameState(prev => ({
      ...prev,
      myCards: cards,
      state: 'MUS_DECISION',
      waitingForMus: true,
      isDealer: prev.myPosition === 0
    }));
  };

  const voteMus = (wantsMus) => {
    setGameState(prev => ({
      ...prev,
      musVotes: { ...prev.musVotes, [prev.myPosition]: wantsMus },
      waitingForMus: false
    }));

    setTimeout(() => {
      const allVoted = Object.keys(gameState.musVotes).length === 3;
      if (allVoted) {
        if (wantsMus && Math.random() > 0.5) {
          distributeCards();
        } else {
          setGameState(prev => ({ ...prev, state: 'GRAND', waitingForMus: false }));
        }
      }
    }, 1000);
  };

  const leaveRoom = () => {
    setGameState({
      roomId: null,
      state: 'WAITING',
      players: [],
      teams: { A: [], B: [] },
      myCards: [],
      myPosition: null,
      dealerPosition: 0,
      isDealer: false,
      currentTurn: 0,
      scores: { A: 0, B: 0 },
      musVotes: {},
      waitingForMus: false
    });
  };

  const canStartGame = gameState.players.length === 4 && gameState.myPosition === 0;
  const isInLobby = gameState.state === 'LOBBY' || gameState.state === 'WAITING';
  const isPlaying = !['WAITING', 'LOBBY'].includes(gameState.state);
  const myTeam = gameState.myPosition !== null ? (gameState.myPosition % 2 === 0 ? 'A' : 'B') : null;

  return {
    gameState,
    connected,
    error,
    loading,
    createRoom,
    joinRoom,
    startGame,
    voteMus,
    leaveRoom,
    canStartGame,
    isInLobby,
    isPlaying,
    myTeam
  };
};

const Card = ({ suit, value }) => {
  const isRed = suit === '<3' || suit === '?';
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
        <div className="text-xs">ï¿½quipe {team}</div>
        {!player?.connected && <div className="text-xs text-yellow-200">Dï¿½connectï¿½</div>}
      </div>
    </div>
  );
};

export default function MusGame() {
  const [screen, setScreen] = useState('HOME');
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [copied, setCopied] = useState(false);

  const {
    gameState,
    connected,
    error,
    loading,
    createRoom,
    joinRoom,
    startGame,
    voteMus,
    leaveRoom,
    canStartGame,
    myTeam
  } = useGameSimulation();

  const handleCreateRoom = async () => {
    if (playerName.trim()) {
      const result = await createRoom(playerName);
      if (result.success) {
        setScreen('LOBBY');
      }
    }
  };

  const handleJoinRoom = async () => {
    if (playerName.trim() && roomIdInput.trim()) {
      const result = await joinRoom(roomIdInput.toUpperCase(), playerName);
      if (result.success) {
        setScreen('LOBBY');
      }
    }
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(gameState.roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartGame = () => {
    startGame();
    setScreen('GAME');
  };

  const handleVoteMus = (wantsMus) => {
    voteMus(wantsMus);
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    setScreen('HOME');
    setPlayerName('');
    setRoomIdInput('');
  };

  // Notification d'erreur
  const ErrorNotification = () => {
    if (!error) return null;
    
    return (
      <div className="fixed top-4 right-4 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-slide-in">
        <AlertCircle size={20} />
        <span>{error}</span>
      </div>
    );
  };

  // HOME SCREEN
  if (screen === 'HOME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <ErrorNotification />
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <h1 className="text-4xl font-bold text-center text-green-800 mb-2">? MUS BASQUE</h1>
          <p className="text-center text-gray-600 mb-8">Jeu de cartes traditionnel basque</p>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Votre pseudo
            </label>
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
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              ) : (
                <>
                  <PlayCircle size={20} />
                  Crï¿½er une partie
                </>
              )}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">ou</span>
              </div>
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
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              ) : (
                <>
                  <Users size={20} />
                  Rejoindre une partie
                </>
              )}
            </button>
          </div>

          <div className="mt-6 text-center">
            <div className={`inline-flex items-center gap-2 ${connected ? 'text-green-600' : 'text-red-600'}`}>
              {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span className="text-sm">{connected ? 'Connectï¿½ au serveur' : 'Dï¿½connectï¿½'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LOBBY SCREEN
  if (screen === 'LOBBY') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-green-600 flex items-center justify-center p-4">
        <ErrorNotification />
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold text-green-800">Salle de jeu</h2>
            <button
              onClick={handleLeaveRoom}
              className="text-red-600 hover:text-red-700 flex items-center gap-2 transition-colors"
            >
              <LogOut size={20} />
              Quitter
            </button>
          </div>

          <div className="bg-gradient-to-r from-green-100 to-green-50 rounded-lg p-4 mb-6 flex items-center justify-between border-2 border-green-200">
            <div>
              <div className="text-sm text-gray-600 font-medium">Code de la salle</div>
              <div className="text-3xl font-mono font-bold text-green-800">{gameState.roomId}</div>
            </div>
            <button
              onClick={handleCopyRoomId}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 transition-colors"
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Copiï¿½ !' : 'Copier'}
            </button>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-800">
                Joueurs ({gameState.players.length}/4)
              </h3>
              {gameState.players.length < 4 && (
                <div className="flex items-center gap-2 text-orange-600 font-medium text-sm">
                  <div className="animate-pulse w-2 h-2 bg-orange-600 rounded-full"></div>
                  En attente de joueurs...
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* ï¿½quipe A */}
              <div className="bg-blue-50 rounded-lg p-4 border-2 border-blue-200">
                <div className="text-center font-bold text-blue-800 mb-3 flex items-center justify-center gap-2">
                  <span>?</span>
                  <span>ï¿½quipe A</span>
                </div>
                <div className="space-y-2">
                  {[0, 2].map(pos => {
                    const player = gameState.players.find(p => p.position === pos);
                    return (
                      <div
                        key={pos}
                        className={`bg-white rounded-lg p-3 transition-all ${player ? 'border-2 border-blue-400 shadow-sm' : 'border-2 border-dashed border-gray-300'}`}
                      >
                        {player ? (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{player.name}</span>
                            {player.position === gameState.myPosition && (
                              <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-1 rounded font-bold">VOUS</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-400 text-center">En attente...</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ï¿½quipe B */}
              <div className="bg-red-50 rounded-lg p-4 border-2 border-red-200">
                <div className="text-center font-bold text-red-800 mb-3 flex items-center justify-center gap-2">
                  <span>?</span>
                  <span>ï¿½quipe B</span>
                </div>
                <div className="space-y-2">
                  {[1, 3].map(pos => {
                    const player = gameState.players.find(p => p.position === pos);
                    return (
                      <div
                        key={pos}
                        className={`bg-white rounded-lg p-3 transition-all ${player ? 'border-2 border-red-400 shadow-sm' : 'border-2 border-dashed border-gray-300'}`}
                      >
                        {player ? (
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{player.name}</span>
                            {player.position === gameState.myPosition && (
                              <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-1 rounded font-bold">VOUS</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-gray-400 text-center">En attente...</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {canStartGame && (
            <button
              onClick={handleStartGame}
              disabled={loading}
              className="w-full bg-green-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <PlayCircle size={24} />
              Lancer la partie
            </button>
          )}

          {gameState.players.length === 4 && !canStartGame && (
            <div className="text-center text-gray-600 py-4 bg-gray-50 rounded-lg">
              <div className="animate-pulse">En attente que l'hï¿½te lance la partie...</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // GAME SCREEN
  if (screen === 'GAME') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-900 to-green-700 relative overflow-hidden">
        <ErrorNotification />
        
        {/* Table de jeu */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-[800px] h-[600px] bg-green-800 rounded-full shadow-2xl border-8 border-yellow-900">
            
            {/* Positions des joueurs */}
            {gameState.players.map((player, idx) => {
              const team = idx % 2 === 0 ? 'A' : 'B';
              return (
                <PlayerSlot
                  key={player.id}
                  player={player}
                  position={idx}
                  isMe={idx === gameState.myPosition}
                  team={team}
                />
              );
            })}

            {/* Centre de la table */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="bg-yellow-900 text-yellow-100 px-6 py-3 rounded-lg shadow-lg">
                <div className="text-sm font-medium">Phase actuelle</div>
                <div className="text-2xl font-bold mt-1">
                  {gameState.state === 'MUS_DECISION' ? 'MUS ?' : gameState.state}
                </div>
              </div>
              {gameState.isDealer && (
                <div className="mt-4 bg-orange-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">
                  ? DONNEUR
                </div>
              )}
              
              {/* Scores */}
              <div className="mt-4 flex gap-4 justify-center">
                <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
                  <div className="text-xs">ï¿½quipe A</div>
                  <div className="text-2xl font-bold">{gameState.scores.A}</div>
                </div>
                <div className="bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg">
                  <div className="text-xs">ï¿½quipe B</div>
                  <div className="text-2xl font-bold">{gameState.scores.B}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cartes du joueur */}
        {gameState.myCards.length > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-4 z-20">
            {gameState.myCards.map((card, idx) => (
              <Card key={idx} suit={card.suit} value={card.value} />
            ))}
          </div>
        )}

        {/* Boutons d'action MUS */}
        {gameState.waitingForMus && (
          <div className="fixed bottom-40 left-1/2 -translate-x-1/2 flex gap-4 z-20">
            <button 
              onClick={() => handleVoteMus(false)}
              className="bg-red-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-red-700 shadow-2xl transition-all transform hover:scale-105"
            >
              IDOKI (Pas de Mus)
            </button>
            <button 
              onClick={() => handleVoteMus(true)}
              className="bg-green-600 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-green-700 shadow-2xl transition-all transform hover:scale-105"
            >
              MUS (Changer)
            </button>
          </div>
        )}

        {/* Info attente vote */}
        {!gameState.waitingForMus && gameState.state === 'MUS_DECISION' && (
          <div className="fixed bottom-40 left-1/2 -translate-x-1/2 bg-yellow-900 text-yellow-100 px-6 py-3 rounded-lg shadow-lg z-20">
            <div className="flex items-center gap-2">
              <div className="animate-pulse w-2 h-2 bg-yellow-300 rounded-full"></div>
              <span>En attente des autres joueurs... ({Object.keys(gameState.musVotes).length}/4)</span>
            </div>
          </div>
        )}

        {/* Bouton quitter */}
        <button
          onClick={handleLeaveRoom}
          className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2 shadow-lg transition-colors z-30"
        >
          <LogOut size={18} />
          Quitter
        </button>

        {/* Info connexion */}
        <div className="fixed top-4 left-4 bg-white/90 backdrop-blur rounded-lg px-4 py-2 text-sm shadow-lg z-30">
          <div className="flex items-center gap-2">
            {connected ? <Wifi size={16} className="text-green-600" /> : <WifiOff size={16} className="text-red-600" />}
            <span className="font-medium">{connected ? 'Connectï¿½' : 'Dï¿½connectï¿½'}</span>
          </div>
          <div className="text-xs text-gray-600 mt-1">Salle: {gameState.roomId}</div>
          <div className="text-xs text-gray-600">ï¿½quipe: {myTeam}</div>
        </div>
      </div>
    );
  }

  return null;
}