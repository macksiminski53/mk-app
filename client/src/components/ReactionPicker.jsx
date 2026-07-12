import { useEffect, useRef, useState } from 'react';
import { EMOJI_GRID } from './EmojiPicker.jsx';

// Discord-style reaction pills under a message: each unique emoji shows a
// count and highlights if the viewer has reacted with it; clicking a pill
// toggles your own reaction. The "+" button opens a small picker to add a
// new emoji reaction, reusing the same curated grid as the message composer.
// Free feature -- no tier gate, unlike the single heart-shaped LikeButton.
export default function ReactionPicker({ reactions = [], currentUserId, onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  if (reactions.length === 0 && !open) {
    return (
      <span className="reaction-add-btn" onClick={() => setOpen(true)} title="Add reaction">
        +
      </span>
    );
  }

  return (
    <div className="reaction-row" ref={wrapRef}>
      {reactions.map((r) => {
        const mine = r.users.some((u) => u.userId === currentUserId);
        return (
          <span
            key={r.emoji}
            className={`reaction-pill ${mine ? 'reaction-pill-mine' : ''}`}
            title={r.users.map((u) => u.displayName || u.username).join(', ')}
            onClick={() => onToggle(r.emoji)}
          >
            {r.emoji} {r.count}
          </span>
        );
      })}
      <span className="reaction-add-btn" onClick={() => setOpen((v) => !v)} title="Add reaction">
        +
      </span>
      {open && (
        <div className="reaction-picker-popover">
          {EMOJI_GRID.map((emoji) => (
            <span
              key={emoji}
              className="emoji-picker-option"
              onClick={() => { onToggle(emoji); setOpen(false); }}
            >
              {emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
