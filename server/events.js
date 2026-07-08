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
