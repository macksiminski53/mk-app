// A tiny in-process event bus so route handlers (REST) can notify the
// Socket.io layer (index.js) that a user's profile changed, without the
// routes needing direct access to the `io` instance. This way ANY client
// that hits the REST API - the browser, or an external tool like the music
// reporter - triggers the same real-time broadcast to friends.
import { EventEmitter } from 'events';

export const events = new EventEmitter();

export function emitProfileChanged(userId) {
  events.emit('user:profile-changed', { userId });
}

// Fired once a Mega Chat's $1 (or 50c ULTRA) Stripe purchase actually
// completes and the server row has been created -- lets the buyer's client
// pick it up in real time instead of waiting for a manual refresh.
export function emitMegaChatReady(userId, server) {
  events.emit('megachat:ready', { userId, server });
}
