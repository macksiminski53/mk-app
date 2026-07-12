import { CUSTOM_EMOJI_MARKER } from './EmojiPicker.jsx';

// Splits on either the custom-emoji marker or a $mention token, keeping the
// delimiters (capturing group) so both can be swapped for React nodes in one
// pass over the string.
const TOKEN_RE = /(:mkemoji:|\$[a-zA-Z0-9_]{2,32})/g;
const MENTION_TOKEN_RE = /^\$[a-zA-Z0-9_]{2,32}$/;

// Renders message content with MK ULTRA custom emoji markers swapped for an
// <img>, and $mentions highlighted as a pill -- MK uses `$` instead of the
// conventional `@` for mentions. `selfUsername` (case-insensitive) gets an
// extra "mention-self" class so a ping aimed at the viewer stands out,
// mirroring Discord's own highlight-when-it's-you behavior.
export function renderMessageContent(content, customEmojiUrl, selfUsername) {
  if (!content) return content;
  const parts = content.split(TOKEN_RE);
  const selfLower = (selfUsername || '').toLowerCase();
  return parts.map((part, i) => {
    if (!part) return null;
    if (part === CUSTOM_EMOJI_MARKER) {
      if (!customEmojiUrl) return null;
      return <img key={`emoji-${i}`} className="inline-custom-emoji" src={customEmojiUrl} alt="custom emoji" />;
    }
    if (MENTION_TOKEN_RE.test(part)) {
      const name = part.slice(1).toLowerCase();
      const isSelf = !!selfLower && name === selfLower;
      return (
        <span key={`mention-${i}`} className={`mention-tag ${isSelf ? 'mention-self' : ''}`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

// Detects a $mention being typed at the very end of a draft (e.g. "hey $ma")
// so the caller can show an autocomplete popover. Returns the partial
// username typed so far (possibly empty), or null if the cursor isn't
// inside a $mention token.
export function getMentionQuery(text) {
  const m = /\$([a-zA-Z0-9_]{0,32})$/.exec(text || '');
  return m ? m[1] : null;
}

// Replaces the trailing partial $mention in a draft with the picked
// username, adding a trailing space so typing can continue immediately.
export function applyMentionPick(text, username) {
  return text.replace(/\$[a-zA-Z0-9_]{0,32}$/, `$${username} `);
}
