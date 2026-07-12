// Lightweight autocomplete popover shown above the message input while
// typing a $mention -- click-only (no keyboard nav), matching the same
// simplicity level as GifPicker/EmojiPicker elsewhere in this codebase.
// `candidates` is whatever's mentionable in the current chat (the DM
// partner, a Mega Chat's members, or a Mini Chat's members).
export default function MentionAutocomplete({ query, candidates, onPick }) {
  const q = (query || '').toLowerCase();
  const matches = (candidates || [])
    .filter((c) => c.username.toLowerCase().includes(q))
    .slice(0, 6);
  if (matches.length === 0) return null;
  return (
    <div className="mention-autocomplete">
      {matches.map((c) => (
        <div
          key={c.username}
          className="mention-autocomplete-option"
          onMouseDown={(e) => { e.preventDefault(); onPick(c.username); }}
        >
          <span className="mention-autocomplete-name">{c.displayName || c.username}</span>
          <span className="mention-autocomplete-handle">${c.username}</span>
        </div>
      ))}
    </div>
  );
}
