// frontend/src/utils/socketClient.js
// Client WebSocket pour la connexion au backend

import io from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001';

class SocketClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.listeners = new Map();
  }

  // Connexion au serveur
  connect() {
    if (this.socket && this.socket.connected) {
      console.log('Socket dï¿½jï¿½ connectï¿½');
      return;
    }

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    this.setupDefaultListeners();
  }

  // Listeners par dï¿½faut
  setupDefaultListeners() {
    this.socket.on('connect', () => {
      console.log('? Connectï¿½ au serveur', this.socket.id);
      this.connected = true;
      this.emit('connection_status', { connected: true });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('? Dï¿½connectï¿½ du serveur:', reason);
      this.connected = false;
      this.emit('connection_status', { connected: false, reason });
    });

    this.socket.on('connect_error', (error) => {
      console.error('Erreur de connexion:', error);
      this.emit('connection_error', error);
    });

    this.socket.on('ERROR', (data) => {
      console.error('Erreur serveur:', data.message);
      this.emit('server_error', data);
    });

    // Heartbeat
    setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('PING');
      }
    }, 30000);

    this.socket.on('PONG', () => {
      // Connexion active
    });
  }

  // Dï¿½connexion
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  // ==================== ï¿½Vï¿½NEMENTS SORTANTS ====================

  // US2: Crï¿½er une salle
  createRoom(playerName) {
    return new Promise((resolve, reject) => {
      this.socket.emit('CREATE_ROOM', { playerName });
      
      this.socket.once('ROOM_CREATED', (data) => {
        resolve(data);
      });

      this.socket.once('ERROR', (error) => {
        reject(error);
      });

      // Timeout aprï¿½s 5 secondes
      setTimeout(() => reject({ message: 'Timeout' }), 5000);
    });
  }

  // US1: Rejoindre une salle
  joinRoom(roomId, playerName) {
    return new Promise((resolve, reject) => {
      this.socket.emit('JOIN_ROOM', { roomId, playerName });
      
      this.socket.once('GAME_STATE_UPDATE', (data) => {
        resolve(data);
      });

      this.socket.once('ERROR', (error) => {
        reject(error);
      });

      setTimeout(() => reject({ message: 'Timeout' }), 5000);
    });
  }

  // US4 & US5: Dï¿½marrer la partie
  startGame() {
    this.socket.emit('START_GAME');
  }

  // US9: Vote Mus
  voteMus(wantsMus) {
    this.socket.emit('MUS_VOTE', { wantsMus });
  }

  // US7: Quitter la salle
  leaveRoom() {
    this.socket.emit('LEAVE_ROOM');
  }

  // Action gï¿½nï¿½rique du joueur
  sendAction(action, data) {
    this.socket.emit('PLAYER_ACTION', { action, data });
  }

  // ==================== ï¿½Vï¿½NEMENTS ENTRANTS ====================

  // S'abonner ï¿½ un ï¿½vï¿½nement
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);

    // ï¿½couter l'ï¿½vï¿½nement Socket.io
    this.socket.on(event, callback);
  }

  // Se dï¿½sabonner d'un ï¿½vï¿½nement
  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }

    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // ï¿½mettre un ï¿½vï¿½nement local (pour les composants)
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        callback(data);
      });
    }
  }

  // ==================== HELPERS ====================

  isConnected() {
    return this.connected && this.socket && this.socket.connected;
  }

  getSocketId() {
    return this.socket ? this.socket.id : null;
  }
}

// Export d'une instance singleton
const socketClient = new SocketClient();
export default socketClient;