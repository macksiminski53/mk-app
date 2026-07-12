import { useEffect, useRef, useState } from 'react';
import { SmileIcon } from './Icons.jsx';

// MK PREMIUM perk: a small emoji picker for the message box. Deliberately a
// fixed, curated grid rather than a full Unicode emoji library -- keeps the
// bundle light and the popover simple. Clicking an emoji inserts it at the
// end of the current draft via onSelect and closes the popover.
export const EMOJI_GRID = [
  '😀', '😂', '😅', '😉', '😍', '😎', '🤔', '😴',
  '😭', '😡', '🥳', '😱', '🤗', '🤝', '👍', '👎',
  '👏', '🙌', '🔥', '💯', '❤️', '💀', '🎉', '✨',
  '🙏', '😬', '😮', '🤯', '🥶', '👀', '🤡', '💩',
];

// MK ULTRA perk: a personal custom emoji. It's inserted into the draft as
// this plain-text marker (same mechanism as every other emoji above);
// MessageContent.jsx's renderMessageContent swaps that marker back out for
// an <img> when the message is displayed (and also handles $mention
// highlighting in the same pass) -- using whoever *sent* the message's
// uploaded image, not the viewer's, so it renders correctly for everyone.
export const CUSTOM_EMOJI_MARKER = ':mkemoji:';

export default function EmojiPicker({ onSelect, customEmojiUrl }) {
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
        title="Emoji (MK PREMIUM)"
      >
        <SmileIcon size={17} />
      </button>
      {open && (
        <div className="emoji-picker-popover">
          {customEmojiUrl && (
            <img
              className="emoji-picker-option emoji-picker-custom"
              src={customEmojiUrl}
              alt="your custom emoji"
              title="Your custom emoji (MK ULTRA)"
              onClick={() => {
                onSelect(CUSTOM_EMOJI_MARKER);
                setOpen(false);
              }}
            />
          )}
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
