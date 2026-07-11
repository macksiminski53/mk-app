import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitProfileChanged, emitMegaChatReady } from '../events.js';

// Two ways to configure MK ULTRA checkout, in order of preference:
//  1. STRIPE_PAYMENT_LINK -- a Stripe-hosted Payment Link (buy.stripe.com/...).
//     No secret API key needed at all; the user's id is passed along via the
//     `client_reference_id` query param, which Stripe carries through to the
//     webhook event the same way a Checkout Session would.
//  2. STRIPE_SECRET_KEY -- creates a Checkout Session per-purchase via the
//     API instead, for when a static Payment Link isn't flexible enough.
// Either way, STRIPE_WEBHOOK_SECRET is what actually grants MK ULTRA (via
// the webhook below) -- until it's set, webhook events are still processed
// but unsigned, which is fine for local testing but must not ship live.
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const paymentLink = process.env.STRIPE_PAYMENT_LINK;

const checkoutConfigured = !!(paymentLink || stripeSecret);

const SERVER_COLORS = ['#8B0000', '#B22222', '#DC143C', '#A52A2A', '#FF6347', '#CD5C5C'];
function randomServerColor() {
  return SERVER_COLORS[Math.floor(Math.random() * SERVER_COLORS.length)];
}

// The `stripe` package is loaded lazily (only the first time it's actually
// needed) instead of at server boot. This keeps it from ever being able to
// affect startup at all -- if loading/constructing it ever fails for any
// reason, only the specific request that needed it gets a 500, instead of
// the whole server crashing before it can even start listening.
let stripePromise = null;
async function getStripe() {
  if (!stripePromise) {
    stripePromise = import('stripe').then(({ default: Stripe }) => {
      return new Stripe(stripeSecret || 'sk_test_unconfigured_placeholder');
    });
  }
  return stripePromise;
}

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const router = Router();

// Kick off a $1 one-time MK ULTRA purchase. Returns a URL the client
// redirects the browser to -- either the static Payment Link (with this
// user's id attached) or a freshly-created Checkout Session.
router.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
  if (paymentLink) {
    const url = new URL(paymentLink);
    url.searchParams.set('client_reference_id', String(req.user.id));
    await db.prepare(
      'INSERT INTO ultra_purchases (user_id, stripe_session_id, status) VALUES (?, ?, ?)'
    ).run(req.user.id, `link:${req.user.id}:${Date.now()}`, 'pending');
    return res.json({ url: url.toString() });
  }

  if (!stripeSecret) return res.status(503).json({ error: 'Payments are not configured yet' });

  const stripe = await getStripe();
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'MK ULTRA',
            description: 'Permanent chats, GIF avatars, custom UI color, and a badge next to your name.',
          },
          unit_amount: 100, // $1.00
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}?ultra=success`,
    cancel_url: `${origin}?ultra=cancelled`,
    client_reference_id: String(req.user.id),
    metadata: { userId: String(req.user.id) },
  });

  await db.prepare(
    'INSERT INTO ultra_purchases (user_id, stripe_session_id, status) VALUES (?, ?, ?)'
  ).run(req.user.id, session.id, 'pending');

  res.json({ url: session.url });
}));

// Kick off a Mega Chat (paid Discord-style server) purchase -- $1 normally,
// 50c for MK ULTRA members. Needs STRIPE_SECRET_KEY (a static Payment Link
// can't vary its price per-user), so this always uses a dynamically-created
// Checkout Session rather than falling back to STRIPE_PAYMENT_LINK like the
// MK ULTRA /checkout route above does. The server itself isn't created until
// the webhook below confirms payment -- until then we only remember the
// requested name in mega_chat_purchases.
router.post('/mega-chat-checkout', requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;
  const clean = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  if (!clean) return res.status(400).json({ error: 'Server name is required' });

  if (!stripeSecret) return res.status(503).json({ error: 'Payments are not configured yet' });

  const row = await db.prepare('SELECT is_ultra FROM users WHERE id = ?').get(req.user.id);
  const isUltra = !!row?.is_ultra;
  const unitAmount = isUltra ? 50 : 100; // 50c for MK ULTRA, $1 otherwise

  const stripe = await getStripe();
  const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Mega Chat: ${clean}`,
            description: 'A new Mega Chat server with unlimited members.',
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}?megachat=success`,
    cancel_url: `${origin}?megachat=cancelled`,
    client_reference_id: String(req.user.id),
    metadata: { userId: String(req.user.id), type: 'megachat', pendingName: clean },
  });

  await db.prepare(
    'INSERT INTO mega_chat_purchases (user_id, stripe_session_id, pending_name, status) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, session.id, clean, 'pending');

  res.json({ url: session.url });
}));

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT is_ultra, ultra_color FROM users WHERE id = ?').get(req.user.id);
  res.json({
    isUltra: !!row?.is_ultra,
    ultraColor: row?.ultra_color || null,
    configured: checkoutConfigured,
  });
}));

router.patch('/ultra-color', requireAuth, asyncHandler(async (req, res) => {
  const row = await db.prepare('SELECT is_ultra FROM users WHERE id = ?').get(req.user.id);
  if (!row?.is_ultra) return res.status(403).json({ error: 'MK ULTRA required' });

  const { color } = req.body;
  const clean = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
  await db.prepare('UPDATE users SET ultra_color = ? WHERE id = ?').run(clean, req.user.id);
  emitProfileChanged(req.user.id);
  res.json({ ultraColor: clean });
}));

export default router;

// Called from index.js with the raw (unparsed) request body -- Stripe's
// signature verification needs the exact bytes that were sent, so this
// route must NOT go through express.json() first.
export async function handleStripeWebhook(req, res) {
  if (!checkoutConfigured) return res.status(503).end();

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (webhookSecret) {
      const stripe = await getStripe();
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // No webhook secret configured yet -- accept unsigned events so local
      // testing works, but this MUST have a real webhook secret before going
      // live (otherwise anyone could POST a fake "payment completed" event).
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = Number(session.client_reference_id || session.metadata?.userId);
    const purchaseType = session.metadata?.type;

    if (userId && purchaseType === 'megachat') {
      const purchase = await db.prepare(
        "SELECT * FROM mega_chat_purchases WHERE stripe_session_id = ? AND status = 'pending'"
      ).get(session.id);
      if (purchase) {
        await db.prepare("UPDATE mega_chat_purchases SET status = 'completed' WHERE id = ?").run(purchase.id);

        const serverInfo = await db.prepare(
          'INSERT INTO servers (name, owner_id, icon_color) VALUES (?, ?, ?)'
        ).run(purchase.pending_name, userId, randomServerColor());
        const serverId = serverInfo.lastInsertRowid;

        await db.prepare(
          'INSERT INTO server_members (server_id, user_id) VALUES (?, ?)'
        ).run(serverId, userId);

        const channelInfo = await db.prepare(
          'INSERT INTO server_channels (server_id, name, position) VALUES (?, ?, ?)'
        ).run(serverId, 'general', 0);

        const server = {
          id: Number(serverId),
          name: purchase.pending_name,
          ownerId: userId,
          iconColor: (await db.prepare('SELECT icon_color FROM servers WHERE id = ?').get(serverId)).icon_color,
          channels: [{ id: Number(channelInfo.lastInsertRowid), name: 'general', position: 0 }],
        };
        emitMegaChatReady(userId, server);
      }
    } else if (userId) {
      await db.prepare("UPDATE ultra_purchases SET status = 'completed' WHERE stripe_session_id = ?").run(session.id);
      await db.prepare('UPDATE users SET is_ultra = 1 WHERE id = ?').run(userId);
      emitProfileChanged(userId);
    }
  }

  res.json({ received: true });
}
