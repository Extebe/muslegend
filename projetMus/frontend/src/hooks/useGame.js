// frontend/src/hooks/useGame.js
// Hook React personnalisï¿½ pour gï¿½rer l'ï¿½tat du jeu et les ï¿½vï¿½nements Socket

import { useState, useEffect, useCallback } from 'react';
import socketClient from '../utils/socketClient';

export const useGame = () => {
  const [gameState, setGameState] = useState({
    roomId: null,
    state: 'DISCONNECTED', // DISCONNECTED, WAITING, LOBBY, MUS_DECISION, GRAND, etc.
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

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // ==================== INITIALISATION ====================

  useEffect(() => {
    // Connecter au serveur
    socketClient.connect();

    // Listeners pour l'ï¿½tat de connexion
    const handleConnectionStatus = ({ connected }) => {
      setConnected(connected);
      if (!connected) {
        setGameState(prev => ({ ...prev, state: 'DISCONNECTED' }));
      }
    };

    const handleServerError = (errorData) => {
      setError(errorData.message);
      setLoading(false);
      setTimeout(() => setError(null), 5000);
    };

    const handleConnectionError = (error) => {
      console.error('Erreur de connexion:', error);
      setError('Impossible de se connecter au serveur');
      setConnected(false);
    };

    socketClient.on('connection_status', handleConnectionStatus);
    socketClient.on('server_error', handleServerError);
    socketClient.on('connection_error', handleConnectionError);

    // Cleanup
    return () => {
      socketClient.off('connection_status', handleConnectionStatus);
      socketClient.off('server_error', handleServerError);
      socketClient.off('connection_error', handleConnectionError);
    };
  }, []);

  // ==================== ï¿½Vï¿½NEMENTS DU JEU ====================

  useEffect(() => {
    if (!socketClient.isConnected()) return;

    // US2: Salle crï¿½ï¿½e
    const handleRoomCreated = (data) => {
      setGameState(data.gameState);
      setLoading(false);
    };

    // US3 & US5: Mise ï¿½ jour de l'ï¿½tat du jeu
    const handleGameStateUpdate = (data) => {
      setGameState(prev => ({
        ...prev,
        ...data.gameState
      }));
    };

    // US3: ï¿½quipes attribuï¿½es
    const handleTeamsAssigned = (data) => {
      console.log('ï¿½quipes attribuï¿½es:', data.teams);
    };

    // US8 & US10: Partie dï¿½marrï¿½e
    const handleGameStarted = (data) => {
      setGameState(prev => ({
        ...prev,
        ...data.gameState
      }));
    };

    // US11: Mus acceptï¿½ par tous
    const handleMusAccepted = (data) => {
      console.log('Mus acceptï¿½ - Redistribution:', data.message);
      setGameState(prev => ({
        ...prev,
        ...data.gameState
      }));
    };

    // US12: Mus refusï¿½
    const handleMusRefused = (data) => {
      console.log('Mus refusï¿½ - Dï¿½but du jeu:', data.message);
      setGameState(prev => ({
        ...prev,
        ...data.gameState
      }));
    };

    // US36: Joueur dï¿½connectï¿½
    const handlePlayerDisconnected = (data) => {
      console.warn(`Joueur ${data.playerName} dï¿½connectï¿½`);
      setError(`${data.playerName} s'est dï¿½connectï¿½`);
      setTimeout(() => setError(null), 3000);
    };

    // Partie annulï¿½e
    const handleGameCancelled = (data) => {
      setError(data.message);
      setGameState(prev => ({
        ...prev,
        state: 'WAITING',
        players: [],
        teams: { A: [], B: [] }
      }));
    };

    // Enregistrer les listeners
    socketClient.on('ROOM_CREATED', handleRoomCreated);
    socketClient.on('GAME_STATE_UPDATE', handleGameStateUpdate);
    socketClient.on('TEAMS_ASSIGNED', handleTeamsAssigned);
    socketClient.on('GAME_STARTED', handleGameStarted);
    socketClient.on('MUS_ACCEPTED', handleMusAccepted);
    socketClient.on('MUS_REFUSED', handleMusRefused);
    socketClient.on('PLAYER_DISCONNECTED', handlePlayerDisconnected);
    socketClient.on('GAME_CANCELLED', handleGameCancelled);

    // Cleanup
    return () => {
      socketClient.off('ROOM_CREATED', handleRoomCreated);
      socketClient.off('GAME_STATE_UPDATE', handleGameStateUpdate);
      socketClient.off('TEAMS_ASSIGNED', handleTeamsAssigned);
      socketClient.off('GAME_STARTED', handleGameStarted);
      socketClient.off('MUS_ACCEPTED', handleMusAccepted);
      socketClient.off('MUS_REFUSED', handleMusRefused);
      socketClient.off('PLAYER_DISCONNECTED', handlePlayerDisconnected);
      socketClient.off('GAME_CANCELLED', handleGameCancelled);
    };
  }, [connected]);

  // ==================== ACTIONS ====================

  // US2: Crï¿½er une salle
  const createRoom = useCallback(async (playerName) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await socketClient.createRoom(playerName);
      setGameState(data.gameState);
      return { success: true, roomId: data.roomId };
    } catch (err) {
      setError(err.message || 'Erreur lors de la crï¿½ation de la salle');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  // US1: Rejoindre une salle
  const joinRoom = useCallback(async (roomId, playerName) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await socketClient.joinRoom(roomId, playerName);
      setGameState(data.gameState);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Erreur lors de la connexion ï¿½ la salle');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  // US4 & US5: Dï¿½marrer la partie
  const startGame = useCallback(() => {
    if (gameState.players.length !== 4) {
      setError('4 joueurs requis pour dï¿½marrer');
      return;
    }
    socketClient.startGame();
  }, [gameState.players.length]);

  // US9: Voter pour le Mus
  const voteMus = useCallback((wantsMus) => {
    socketClient.voteMus(wantsMus);
  }, []);

  // US7: Quitter la salle
  const leaveRoom = useCallback(() => {
    socketClient.leaveRoom();
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
  }, []);

  // Action gï¿½nï¿½rique
  const sendAction = useCallback((action, data) => {
    socketClient.sendAction(action, data);
  }, []);

  // ==================== HELPERS ====================

  const canStartGame = gameState.players.length === 4 && gameState.myPosition === 0;
  const isInLobby = gameState.state === 'LOBBY' || gameState.state === 'WAITING';
  const isPlaying = !['DISCONNECTED', 'WAITING', 'LOBBY'].includes(gameState.state);
  const myTeam = gameState.myPosition !== null ? (gameState.myPosition % 2 === 0 ? 'A' : 'B') : null;

  return {
    // ï¿½tat
    gameState,
    connected,
    error,
    loading,
    
    // Actions
    createRoom,
    joinRoom,
    startGame,
    voteMus,
    leaveRoom,
    sendAction,
    
    // Helpers
    canStartGame,
    isInLobby,
    isPlaying,
    myTeam
  };
};