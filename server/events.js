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

// Broadcasts a Mini Chat's new group picture to every current member so
// their sidebar/chat header update live instead of needing a refresh.
export function emitGroupAvatarChanged(memberIds, groupId, avatarUrl) {
  events.emit('group:avatar-changed', { memberIds, groupId, avatarUrl });
}

// An admin deleted a message via the REST API -- lets every client
// currently viewing that thread/channel/group remove it in real time via
// the same socket room the normal message:new broadcasts already use.
export function emitAdminMessageDeleted(messageType, messageId, roomId) {
  events.emit('admin:message-deleted', { messageType, messageId, roomId });
}

// ---- Podcast ----
// Global broadcast-to-everyone events (started/ended, speaker roster
// changes) go out to all connected clients; per-user events (a join
// request being accepted/declined, or the host being notified of a new
// request) target just that one user's socket room.
export function emitPodcastStarted(session) {
  events.emit('podcast:started', session);
}

export function emitPodcastEnded() {
  events.emit('podcast:ended', {});
}

export function emitPodcastJoinRequest(hostId, requester) {
  events.emit('podcast:join-request', { hostId, requester });
}

export function emitPodcastRequestResolved(userId, accepted) {
  events.emit('podcast:request-resolved', { userId, accepted });
}

export function emitPodcastSpeakerJoined(speaker) {
  events.emit('podcast:speaker-joined', { speaker });
}

export function emitPodcastSpeakerLeft(userId) {
  events.emit('podcast:speaker-left', { userId });
}
