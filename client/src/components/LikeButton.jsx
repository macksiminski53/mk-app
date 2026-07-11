import { HeartIcon } from './Icons.jsx';

// MK PREMIUM perk: liking a message. Anyone can see the like count on a
// message, but only MK PREMIUM/ULTRA members can actually click to
// like/unlike one -- non-eligible users see the count as a plain read-only
// pill instead of a button. `onToggle` should emit the socket
// 'message:like' event and update local state from the ack/broadcast; this
// component is just the control.
export default function LikeButton({ likeCount = 0, likedByMe = false, canLike, onToggle }) {
  if (!canLike && !likeCount) return null;

  if (!canLike) {
    return (
      <span className="like-btn like-btn-readonly" title="Liked by others">
        <HeartIcon size={13} filled /> {likeCount}
      </span>
    );
  }

  return (
    <span
      className={`like-btn ${likedByMe ? 'like-btn-active' : ''}`}
      onClick={onToggle}
      title={likedByMe ? 'Unlike' : 'Like (MK PREMIUM)'}
    >
      <HeartIcon size={13} filled={likedByMe} /> {likeCount > 0 ? likeCount : ''}
    </span>
  );
}
