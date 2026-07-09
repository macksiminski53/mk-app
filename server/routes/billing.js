import { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { emitProfileChanged } from '../events.js';

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

// Used for both real API calls (if stripeSecret is set) and purely-local
// webhook signature verification (which never hits the network, so a
// placeholder key is fine when only the payment-link path is configured).
const stripe = new Stripe(stripeSecret || 'sk_test_unconfigured_placeholder');

const checkoutConfigured = !!(paymentLink || stripeSecret);

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
    if (userId) {
      await db.prepare("UPDATE ultra_purchases SET status = 'completed' WHERE stripe_session_id = ?").run(session.id);
      await db.prepare('UPDATE users SET is_ultra = 1 WHERE id = ?').run(userId);
      emitProfileChanged(userId);
    }
  }

  res.json({ received: true });
}
