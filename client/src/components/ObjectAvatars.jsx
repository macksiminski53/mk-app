// Default profile pictures for users who haven't uploaded a real photo.
// Instead of the old "colored circle + initials" fallback, every account
// gets a randomly-assigned illustration of an everyday object (see
// server/routes/auth.js's OBJECT_AVATARS list, which must stay in sync with
// OBJECT_AVATAR_IDS below), all grayscale so it fits the app's black/gray
// theme rather than clashing with it. Each one is a flat, filled
// illustration that bleeds to the edges of its 100x100 viewBox -- once
// Avatar.jsx clips it into a circle (the same .avatar-img sizing a real
// uploaded photo gets), it reads as a full "picture" rather than a small
// centered icon. Fully original/inline SVG -- no external image fetching.

function CoffeeAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#3f4147" />
      <path d="M20 40h50v28c0 9-7 16-16 16H36c-9 0-16-7-16-16V40Z" fill="#dcddde" />
      <path d="M70 46h6c7 0 12 5 12 12s-5 12-12 12h-6v-10h6c1.5 0 3-1.5 3-3s-1.5-3-3-3h-6V46Z" fill="#dcddde" />
      <path d="M20 40h50v8H20v-8Z" fill="#8a8f98" />
      <path d="M33 34c-2-4 1-6 0-11" stroke="#b5bac1" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M45 34c-2-4 1-6 0-11" stroke="#b5bac1" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <path d="M57 34c-2-4 1-6 0-11" stroke="#b5bac1" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function PlantAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#35373c" />
      <path d="M22 62h56l-6 34H28l-6-34Z" fill="#6d6f78" />
      <path d="M22 62h56l-2 10H24l-2-10Z" fill="#4e5058" />
      <path d="M50 64c0-20-22-16-22-38 22 0 22 20 22 38Z" fill="#dcddde" />
      <path d="M50 64c0-24 24-20 24-42-24 0-24 22-24 42Z" fill="#b5bac1" />
      <path d="M50 64c0-14-13-10-13-26 13 0 13 12 13 26Z" fill="#f2f3f5" />
    </svg>
  );
}

function BookAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <path d="M8 24c14-6 28-6 42 0v56c-14-6-28-6-42 0V24Z" fill="#dcddde" />
      <path d="M92 24c-14-6-28-6-42 0v56c14-6 28-6 42 0V24Z" fill="#f2f3f5" />
      <path d="M50 24v56" stroke="#6d6f78" strokeWidth="3" />
      <path d="M16 34c8-3 18-3 26 1M16 44c8-3 18-3 26 1M16 54c8-3 18-3 26 1" stroke="#8a8f98" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M84 34c-8-3-18-3-26 1M84 44c-8-3-18-3-26 1M84 54c-8-3-18-3-26 1" stroke="#b5bac1" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function CameraAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <path d="M10 38c0-4 3-7 7-7h12l6-9h30l6 9h12c4 0 7 3 7 7v40c0 4-3 7-7 7H17c-4 0-7-3-7-7V38Z" fill="#8a8f98" />
      <circle cx="50" cy="58" r="19" fill="#404249" />
      <circle cx="50" cy="58" r="13" fill="#dcddde" />
      <circle cx="50" cy="58" r="7" fill="#4e5058" />
      <rect x="66" y="36" width="10" height="6" rx="1" fill="#f2f3f5" />
    </svg>
  );
}

function HeadphonesAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#3f4147" />
      <path d="M18 60V52c0-18 14-32 32-32s32 14 32 32v8" stroke="#dcddde" strokeWidth="7" fill="none" strokeLinecap="round" />
      <rect x="8" y="54" width="18" height="30" rx="8" fill="#b5bac1" />
      <rect x="74" y="54" width="18" height="30" rx="8" fill="#f2f3f5" />
    </svg>
  );
}

function BulbAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <path d="M50 12c-15 0-26 11-26 25 0 11 6 17 11 23 3 3 5 7 5 11h20c0-4 2-8 5-11 5-6 11-12 11-23 0-14-11-25-26-25Z" fill="#f2f3f5" />
      <path d="M42 78h16v6a8 8 0 0 1-8 8 8 8 0 0 1-8-8v-6Z" fill="#8a8f98" />
      <path d="M44 40c1-5 4-8 9-9" stroke="#b5bac1" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function RocketAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#35373c" />
      <path d="M50 8c14 12 18 30 18 46 0 8-4 16-18 24-14-8-18-16-18-24 0-16 4-34 18-46Z" fill="#dcddde" />
      <circle cx="50" cy="42" r="9" fill="#4e5058" />
      <path d="M32 58l-14 20 20-8" fill="#8a8f98" />
      <path d="M68 58l14 20-20-8" fill="#b5bac1" />
      <path d="M42 78c0 10 4 16 8 16s8-6 8-16Z" fill="#6d6f78" />
    </svg>
  );
}

function CactusAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#404249" />
      <path d="M20 92l4-30h52l4 30H20Z" fill="#6d6f78" />
      <path d="M42 62V32c0-8 6-14 8-14s8 6 8 14v30h-16Z" fill="#dcddde" />
      <path d="M42 46H28c-6 0-10-4-10-10s4-10 10-10h6v10h-4c-1.5 0-2 1-2 2s.5 2 2 2h10v6Z" fill="#b5bac1" />
      <path d="M58 54h14c6 0 10-4 10-10s-4-10-10-10h-6v10h4c1.5 0 2 1 2 2s-.5 2-2 2H58v6Z" fill="#f2f3f5" />
    </svg>
  );
}

function UmbrellaAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#2b2d31" />
      <path d="M10 46C10 26 28 12 50 12s40 14 40 34H10Z" fill="#dcddde" />
      <path d="M10 46c8-4 16-4 20 0s12 4 20 0 16-4 20 0 12 4 20 0" stroke="#4e5058" strokeWidth="3" fill="none" />
      <path d="M50 12v66c0 6-4 10-9 10" stroke="#8a8f98" strokeWidth="4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function VinylAvatar() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#3f4147" />
      <circle cx="50" cy="50" r="42" fill="#1a1a1e" />
      <circle cx="50" cy="50" r="35" fill="none" stroke="#404249" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="28" fill="none" stroke="#404249" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="21" fill="none" stroke="#404249" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="14" fill="#dcddde" />
      <circle cx="50" cy="50" r="4" fill="#1a1a1e" />
    </svg>
  );
}

// Keys here are what get stored in users.avatar_icon (server/routes/auth.js
// assigns one at random on registration) -- must match OBJECT_AVATARS there
// exactly, since the server only ever sends the id string, not the image.
export const OBJECT_AVATARS = {
  coffee: CoffeeAvatar,
  plant: PlantAvatar,
  book: BookAvatar,
  camera: CameraAvatar,
  headphones: HeadphonesAvatar,
  bulb: BulbAvatar,
  rocket: RocketAvatar,
  cactus: CactusAvatar,
  umbrella: UmbrellaAvatar,
  vinyl: VinylAvatar,
};

export const OBJECT_AVATAR_IDS = Object.keys(OBJECT_AVATARS);
