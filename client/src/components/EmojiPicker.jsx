import { useEffect, useRef, useState } from 'react';

// MK PREMIUM perk: a small emoji picker for the message box. Deliberately a
// fixed, curated grid rather than a full Unicode emoji library -- keeps the
// bundle light and the popover simple. Clicking an emoji inserts it at the
// end of the current draft via onSelect and closes the popover.
const EMOJI_GRID = [
  '😀', '😂', '😅', '😉', '😍', '😎', '🤔', '😴',
  '😭', '😡', '🥳', '😱', '🤗', '🤝', '👍', '👎',
  '👏', '🙌', '🔥', '💯', '❤️', '💀', '🎉', '✨',
  '🙏', '😬', '😮', '🤯', '🥶', '👀', '🤡', '💩',
];

// MK ULTRA perk: a personal custom emoji. It's inserted into the draft as
// this plain-text marker (same mechanism as every other emoji above), and
// renderWithCustomEmoji below swaps that marker back out for an <img> when
// the message is displayed -- using whoever *sent* the message's uploaded
// image, not the viewer's, so it renders correctly for everyone in the chat.
export const CUSTOM_EMOJI_MARKER = ':mkemoji:';

export function renderWithCustomEmoji(content, customEmojiUrl) {
  if (!content || !customEmojiUrl || !content.includes(CUSTOM_EMOJI_MARKER)) return content;
  const parts = content.split(CUSTOM_EMOJI_MARKER);
  const out = [];
  parts.forEach((part, i) => {
    if (part) out.push(part);
    if (i < parts.length - 1) {
      out.push(<img key={`mkemoji-${i}`} className="inline-custom-emoji" src={customEmojiUrl} alt="custom emoji" />);
    }
  });
  return out;
}

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
        😊
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
