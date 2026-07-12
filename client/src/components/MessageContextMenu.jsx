import { useEffect, useRef, useState } from 'react';
import { EMOJI_GRID } from './EmojiPicker.jsx';

// Discord-style right-click menu for a message: Reply / Edit (own messages
// only) / React (opens an inline emoji grid) / Pin-Unpin / Delete (Admin,
// only rendered for admins via onAdminDelete -- lets a moderator remove any
// message in any DM/Mega Chat/Mini Chat without needing to be the author).
// Positioned at the click coordinates (already clamped to stay on-screen by
// the caller). Closes on an outside click, Escape, or after any action is
// taken.
export default function MessageContextMenu({ x, y, canEdit, pinned, onReply, onEdit, onReact, onPin, onAdminDelete, onClose }) {
  const [showEmoji, setShowEmoji] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onOutsideClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    function onEscape(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [onClose]);

  return (
    <div className="message-context-menu" ref={menuRef} style={{ top: y, left: x }}>
      {!showEmoji ? (
        <>
          {onReply && (
            <div
              className="context-menu-item"
              onClick={() => { onReply(); onClose(); }}
            >
              Reply
            </div>
          )}
          {canEdit && (
            <div
              className="context-menu-item"
              onClick={() => { onEdit(); onClose(); }}
            >
              Edit
            </div>
          )}
          <div className="context-menu-item" onClick={() => setShowEmoji(true)}>
            React
          </div>
          <div
            className="context-menu-item"
            onClick={() => { onPin(); onClose(); }}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </div>
          {onAdminDelete && (
            <div
              className="context-menu-item context-menu-item-danger"
              onClick={() => { onAdminDelete(); onClose(); }}
            >
              Delete (Admin)
            </div>
          )}
        </>
      ) : (
        <div className="context-menu-emoji-grid">
          {EMOJI_GRID.map((emoji) => (
            <span
              key={emoji}
              className="emoji-picker-option"
              onClick={() => { onReact(emoji); onClose(); }}
            >
              {emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
