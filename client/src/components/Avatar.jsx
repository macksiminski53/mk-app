import { resolveAvatarUrl } from '../api.js';

export default function Avatar({ username, avatarColor, avatarUrl, size = 40, className = '' }) {
  const url = resolveAvatarUrl(avatarUrl);
  const style = { width: size, height: size, fontSize: size * 0.35 };

  if (url) {
    return (
      <div className={`avatar ${className}`} style={style}>
        <img src={url} alt={username} className="avatar-img" />
      </div>
    );
  }

  return (
    <div className={`avatar ${className}`} style={{ ...style, background: avatarColor || '#8B0000' }}>
      {username?.slice(0, 2).toUpperCase()}
    </div>
  );
}
