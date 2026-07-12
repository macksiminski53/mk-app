import { resolveAvatarUrl } from '../api.js';

// `online` draws a glowing green ring around the avatar (Xbox/Steam-style
// presence indicator) instead of -- or in addition to -- a small corner dot.
// `ultraBorder` is an MK ULTRA perk: an animated gradient ring around the
// avatar, shown for any user who has ULTRA (pass ultraBorder={user.isUltra}).
export default function Avatar({ username, avatarColor, avatarUrl, size = 40, className = '', online = false, ultraBorder = false }) {
  const url = resolveAvatarUrl(avatarUrl);
  const style = { width: size, height: size, fontSize: size * 0.35 };
  const cls = `avatar ${online ? 'avatar-online' : ''} ${ultraBorder ? 'avatar-ultra-border' : ''} ${className}`;

  if (url) {
    return (
      <div className={cls} style={style}>
        <img src={url} alt={username} className="avatar-img" />
      </div>
    );
  }

  return (
    <div className={cls} style={{ ...style, background: avatarColor || '#4e5058' }}>
      {username?.slice(0, 2).toUpperCase()}
    </div>
  );
}
