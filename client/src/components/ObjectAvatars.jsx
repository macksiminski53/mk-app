// Default profile pictures for users who haven't uploaded a real photo.
// Instead of the old "colored circle + initials" fallback, every account
// gets a randomly-assigned illustration of a cable/connector (see
// server/routes/auth.js's OBJECT_AVATARS list, which must stay in sync with
// OBJECT_AVATAR_IDS below), all grayscale so it fits the app's black/gray
// theme rather than clashing with it. Each one is a flat, filled
// illustration that bleeds to the edges of its 100x100 viewBox -- once
// Avatar.jsx clips it into a circle (the same .avatar-img sizing a real
// uploaded photo gets), it reads as a full "picture" rather than a small
// centered icon. Fully original/inline SVG -- no external image fetching.
// Shapes are deliberately bold and simple (not fine-detail realistic) so
// they still read correctly at small avatar sizes down to ~32px.

function UsbAAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <rect x="8" y="34" width="58" height="32" rx="4" fill="#4e5058" />
      <rect x="58" y="42" width="42" height="16" fill="#dcddde" />
      <rect x="58" y="48" width="42" height="4" fill="#8a8f98" />
    </svg>
  );
}

function UsbCAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#35373c" />
      <rect x="6" y="32" width="88" height="36" rx="18" fill="#404249" />
      <rect x="18" y="41" width="64" height="18" rx="9" fill="#dcddde" />
    </svg>
  );
}

function FirewireAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#3f4147" />
      <polygon points="14,50 24,30 82,30 92,42 92,58 82,70 24,70" fill="#4e5058" />
      <polygon points="30,44 30,56 76,56 76,44 60,44 60,50 46,50 46,44" fill="#dcddde" />
    </svg>
  );
}

function LightningAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <rect x="34" y="14" width="32" height="72" rx="9" fill="#dcddde" />
      <rect x="46" y="14" width="8" height="72" fill="#8a8f98" />
      <rect x="42" y="30" width="16" height="10" rx="2" fill="#404249" />
    </svg>
  );
}

function MicroUsbAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <polygon points="20,28 68,28 78,72 10,72" fill="#4e5058" />
      <polygon points="30,38 60,38 66,62 24,62" fill="#dcddde" />
    </svg>
  );
}

function HdmiAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <polygon points="10,32 82,32 92,44 92,60 10,60" fill="#4e5058" />
      <rect x="18" y="42" width="66" height="14" fill="#dcddde" />
      <rect x="22" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="30" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="38" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="46" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="54" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="62" y="42" width="3" height="14" fill="#4e5058" />
      <rect x="70" y="42" width="3" height="14" fill="#4e5058" />
    </svg>
  );
}

function EthernetAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <rect x="22" y="30" width="56" height="46" rx="3" fill="#4e5058" />
      <rect x="40" y="16" width="20" height="18" rx="2" fill="#6d6f78" />
      <rect x="30" y="62" width="4" height="14" fill="#dcddde" />
      <rect x="38" y="62" width="4" height="14" fill="#dcddde" />
      <rect x="46" y="62" width="4" height="14" fill="#dcddde" />
      <rect x="54" y="62" width="4" height="14" fill="#dcddde" />
      <rect x="62" y="62" width="4" height="14" fill="#dcddde" />
      <rect x="70" y="62" width="4" height="14" fill="#dcddde" />
    </svg>
  );
}

function DisplayportAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#3f4147" />
      <polygon points="14,30 78,30 92,44 92,70 14,70" fill="#4e5058" />
      <rect x="22" y="40" width="60" height="20" rx="3" fill="#dcddde" />
    </svg>
  );
}

function AuxAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <rect x="38" y="10" width="24" height="80" rx="12" fill="#dcddde" />
      <rect x="38" y="34" width="24" height="6" fill="#1a1a1e" />
      <rect x="38" y="54" width="24" height="6" fill="#1a1a1e" />
    </svg>
  );
}

function VgaAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <polygon points="16,32 84,32 92,46 92,58 84,72 16,72 8,58 8,46" fill="#4e5058" />
      <circle cx="14" cy="52" r="5" fill="#8a8f98" />
      <circle cx="86" cy="52" r="5" fill="#8a8f98" />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <circle key={`${row}-${col}`} cx={32 + col * 9} cy={42 + row * 9} r="2" fill="#1a1a1e" />
        ))
      )}
    </svg>
  );
}

// Keys here are what get stored in users.avatar_icon (server/routes/auth.js
// assigns one at random on registration) -- must match OBJECT_AVATARS there
// exactly, since the server only ever sends the id string, not the image.
export const OBJECT_AVATARS = {
  'usb-a': UsbAAvatar,
  'usb-c': UsbCAvatar,
  firewire: FirewireAvatar,
  lightning: LightningAvatar,
  'micro-usb': MicroUsbAvatar,
  hdmi: HdmiAvatar,
  ethernet: EthernetAvatar,
  displayport: DisplayportAvatar,
  aux: AuxAvatar,
  vga: VgaAvatar,
};

export const OBJECT_AVATAR_IDS = Object.keys(OBJECT_AVATARS);
