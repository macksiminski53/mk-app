import { Router } from 'express';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

function simplifyResults(data) {
  return (data || [])
    .map((g) => {
      const full = g.images?.original?.url || g.images?.fixed_height?.url;
      const preview = g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || full;
      if (!full) return null;
      return { id: g.id, url: full, previewUrl: preview, description: g.title || 'GIF' };
    })
    .filter(Boolean);
}

router.get('/search', asyncHandler(async (req, res) => {
  if (!GIPHY_API_KEY) return res.status(503).json({ error: 'GIF search is not configured on this server yet' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json({ results: [] });
  const url = `${GIPHY_BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=en`;
  const giphyRes = await fetch(url);
  if (!giphyRes.ok) return res.status(502).json({ error: 'GIF search failed' });
  const data = await giphyRes.json();
  res.json({ results: simplifyResults(data.data) });
}));

router.get('/trending', asyncHandler(async (req, res) => {
  if (!GIPHY_API_KEY) return res.status(503).json({ error: 'GIF search is not configured on this server yet' });
  const url = `${GIPHY_BASE}/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`;
  const giphyRes = await fetch(url);
  if (!giphyRes.ok) return res.status(502).json({ error: 'GIF search failed' });
  const data = await giphyRes.json();
  res.json({ results: simplifyResults(data.data) });
}));

export default router;
