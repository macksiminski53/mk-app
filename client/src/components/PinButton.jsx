import { PinIcon } from './Icons.jsx';

// Pinning is a free perk for everyone (capped at 10 pinned messages per
// chat, enforced server-side) -- unlike LikeButton, there's no tier gate
// here; every user can pin/unpin any message they can see.
export default function PinButton({ pinned = false, onToggle }) {
  return (
    <span
      className={`pin-btn ${pinned ? 'pin-btn-active' : ''}`}
      onClick={onToggle}
      title={pinned ? 'Unpin this message' : 'Pin this message (up to 10 per chat, never auto-deletes)'}
    >
      <PinIcon size={13} />
    </span>
  );
}
