import { useEffect, useRef, useState } from 'react';

// MK ULTRA perk: a small emoji picker for the message box. Deliberately a
// fixed, curated grid rather than a full Unicode emoji library -- keeps the
// bundle light and the popover simple. Clicking an emoji inserts it at the
// end of the current draft via onSelect and closes the popover.
const EMOJI_GRID = [
  '😀', '😂', '😅', '😉', '😍', '😎', '🤔', '😴',
  '😭', '😡', '🥳', '😱', '🤗', '🤝', '👍', '👎',
  '👏', '🙌', '🔥', '💯', '❤️', '💀', '🎉', '✨',
  '🙏', '😬', '😮', '🤯', '🥶', '👀', '🤡', '💩',
];

export default function EmojiPicker({ onSelect }) {
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

  return (
    <div className="emoji-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="emoji-picker-btn"
        onClick={() => setOpen((v) => !v)}
        title="Emoji (MK ULTRA)"
      >
        😊
      </button>
      {open && (
        <div className="emoji-picker-popover">
          {EMOJI_GRID.map((emoji) => (
            <span
              key={emoji}
              className="emoji-picker-option"
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
