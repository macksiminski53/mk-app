import { useEffect, useRef, useState } from 'react';
import { GifIcon } from './Icons.jsx';
import { api } from '../api.js';

// Discord-style GIF picker: a search popover (backed by Giphy via the
// server-side proxy in server/routes/gifs.js, so the API key never reaches
// the browser) that sends the picked GIF immediately as a message, the same
// pattern used for image attachments -- there's no "insert then send"
// intermediate step, matching Discord's own GIF-picker UX.
export default function GifPicker({ token, onSend }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Load trending GIFs as soon as the popover opens (empty-query state),
    // mirroring Discord's picker showing trending GIFs before you type.
    if (!query.trim()) {
      loadTrending();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function loadTrending() {
    setLoading(true);
    setError('');
    try {
      const data = await api.trendingGifs(token);
      setResults(data.results || []);
    } catch (e) {
      setError(e.message || 'Failed to load GIFs');
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(q) {
    setLoading(true);
    setError('');
    try {
      const data = await api.searchGifs(token, q);
      setResults(data.results || []);
    } catch (e) {
      setError(e.message || 'Failed to search GIFs');
    } finally {
      setLoading(false);
    }
  }

  function pick(gif) {
    onSend(gif.url);
    setOpen(false);
    setQuery('');
    setResults([]);
  }

  return (
    <div className="gif-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="gif-picker-btn"
        onClick={() => setOpen((v) => !v)}
        title="Send a GIF"
      >
        <GifIcon size={17} />
      </button>
      {open && (
        <div className="gif-picker-popover">
          <input
            type="text"
            className="gif-picker-search"
            placeholder="Search GIFs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="gif-picker-grid">
            {loading && <div className="gif-picker-status">Loading...</div>}
            {!loading && error && <div className="gif-picker-status">{error}</div>}
            {!loading && !error && results.length === 0 && (
              <div className="gif-picker-status">No GIFs found</div>
            )}
            {!loading &&
              !error &&
              results.map((gif) => (
                <img
                  key={gif.id}
                  className="gif-picker-option"
                  src={gif.previewUrl}
                  alt={gif.description}
                  onClick={() => pick(gif)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
