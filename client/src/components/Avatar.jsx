import { resolveAvatarUrl } from '../api.js';
import { OBJECT_AVATARS } from './ObjectAvatars.jsx';

// `online` draws a glowing green ring around the avatar (Xbox/Steam-style
// presence indicator) instead of -- or in addition to -- a small corner dot.
// `ultraBorder` is an MK ULTRA perk: an animated gradient ring around the
// avatar, shown for any user who has ULTRA (pass ultraBorder={user.isUltra}).
// `avatarIcon` is the random default "picture" every account gets at
// registration (see server/routes/auth.js's OBJECT_AVATARS + ObjectAvatars.jsx)
// -- it only renders when there's no real uploaded avatarUrl, and only if the
// id is one Object Avatars actually knows (older/unmigrated accounts with no
// avatar_icon yet fall back to the plain initials circle below).
export default function Avatar({ username, avatarColor, avatarUrl, avatarIcon, size = 40, className = '', online = false, ultraBorder = false }) {
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

  const ObjectAvatar = avatarIcon ? OBJECT_AVATARS[avatarIcon] : null;
  if (ObjectAvatar) {
    return (
      <div className={cls} style={style}>
        <ObjectAvatar />
      </div>
    );
  }

  return (
    <div className={cls} style={{ ...style, background: avatarColor || '#4e5058' }}>
      {username?.slice(0, 2).toUpperCase()}
    </div>
  );
}
