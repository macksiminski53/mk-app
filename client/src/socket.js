import { io } from 'socket.io-client';
import { API_BASE_URL } from './api.js';

let socket = null;

export function connectSocket(token) {
  if (socket) return socket;
  socket = io(API_BASE_URL, { auth: { token } });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
