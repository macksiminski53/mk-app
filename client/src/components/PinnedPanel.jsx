function formatPinnedTime(createdAt) {
  if (!createdAt) return '';
  const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A free perk: up to `cap` (10) pinned messages per chat, shown here as a
// simple list. Pinned messages are exempt from the free-tier 24h
// auto-delete sweep, so this panel doubles as "the messages that survive".
export default function PinnedPanel({ pinned, onUnpin, onClose, cap = 10 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pinned-panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Pinned Messages ({pinned.length}/{cap})</h2>
        {pinned.length === 0 ? (
          <div className="pinned-panel-empty">
            No pinned messages yet. Pin up to {cap} messages here — they're kept forever, even in a chat that auto-deletes after 24h.
          </div>
        ) : (
          <div className="pinned-panel-list">
            {pinned.map((m) => (
              <div key={m.id} className="pinned-panel-item">
                <div className="pinned-panel-item-meta">
                  <span className="pinned-panel-item-author">{m.username}</span>
                  <span className="pinned-panel-item-time">{formatPinnedTime(m.createdAt)}</span>
                </div>
                <div className="pinned-panel-item-content">
                  {m.content || (m.imageUrl ? 'Attachment' : '')}
                </div>
                <span className="pinned-panel-item-unpin" onClick={() => onUnpin(m.id)}>Unpin</span>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
