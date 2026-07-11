// MK ULTRA perk: liking a message. Anyone can see the like count on a
// message, but only MK ULTRA members can actually click to like/unlike one
// -- non-ULTRA users see the count as a plain read-only pill instead of a
// button. `onToggle` should emit the socket 'message:like' event and update
// local state from the ack/broadcast; this component is just the control.
export default function LikeButton({ likeCount = 0, likedByMe = false, canLike, onToggle }) {
  if (!canLike && !likeCount) return null;

  if (!canLike) {
    return (
      <span className="like-btn like-btn-readonly" title="Liked by others">
        ❤ {likeCount}
      </span>
    );
  }

  return (
    <span
      className={`like-btn ${likedByMe ? 'like-btn-active' : ''}`}
      onClick={onToggle}
      title={likedByMe ? 'Unlike' : 'Like (MK ULTRA)'}
    >
      {likedByMe ? '❤' : '🤍'} {likeCount > 0 ? likeCount : ''}
    </span>
  );
}
