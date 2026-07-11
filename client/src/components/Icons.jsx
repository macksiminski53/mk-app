// Clean stroke-based SVG icons for small UI buttons (pin, like, emoji
// picker toggle), matching CallIcons.jsx's outline style rather than using
// emoji glyphs, which render inconsistently/cartoonish across platforms.
// All icons inherit color via `currentColor` so they pick up whatever
// color the parent button is styled with.

export function PinIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 21s7-7.58 7-12a7 7 0 1 0-14 0c0 4.42 7 12 7 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

// `filled` swaps the heart from an outline to a solid currentColor fill --
// used by LikeButton to show liked (filled) vs not-liked (outline) state,
// the same distinction the old ❤/🤍 pair conveyed.
export function HeartIcon({ size = 14, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 20.5s-7.2-4.5-9.8-8.9C.5 8.4 1.6 4.8 4.9 3.6c2.5-.9 4.8-.1 7.1 2.5 2.3-2.6 4.6-3.4 7.1-2.5 3.3 1.2 4.4 4.8 2.7 8-2.6 4.4-9.8 8.9-9.8 8.9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  );
}

export function SmileIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1.1" fill="currentColor" />
      <circle cx="15" cy="10" r="1.1" fill="currentColor" />
      <path d="M8.3 14.2c1 1.3 2.3 2 3.7 2s2.7-.7 3.7-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
