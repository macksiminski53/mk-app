// Sends transactional purchase-confirmation emails via SendGrid's HTTP API
// directly (fetch), instead of the @sendgrid/mail package -- Node already
// has global fetch, so this avoids adding a new dependency (and the
// npm-install/native-module headaches that come with one) for what's just
// a single POST request.
//
// Needs two env vars on the server:
//   SENDGRID_API_KEY   -- from SendGrid > Settings > API Keys
//   SENDGRID_FROM_EMAIL -- a sender address verified in SendGrid (Settings >
//                          Sender Authentication), e.g. no-reply@yourdomain.com
// Until both are set, sendPurchaseEmail() just logs a warning and no-ops --
// same "degrade gracefully instead of crashing" pattern as Stripe in
// billing.js.
const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL;

export const emailConfigured = !!(apiKey && fromEmail);

async function sendEmail({ to, subject, text }) {
  if (!emailConfigured) {
    console.warn(`[email] SENDGRID_API_KEY/SENDGRID_FROM_EMAIL not set -- skipped email to ${to || '(no address)'}: ${subject}`);
    return;
  }
  if (!to) {
    console.warn(`[email] No recipient email available -- skipped: ${subject}`);
    return;
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: 'MK' },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] SendGrid send failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error('[email] SendGrid send error:', err.message);
  }
}

export function sendPlusPurchaseEmail(to) {
  return sendEmail({
    to,
    subject: 'You\'ve got MK PLUS!',
    text: [
      'Thanks for buying MK PLUS!',
      '',
      'Your account is now upgraded with:',
      '- Permanent chats (no 24h auto-delete)',
      '- GIF avatars',
      '- A custom UI accent color',
      '- A PLUS badge next to your name',
      '',
      'Open MK to see it in action.',
    ].join('\n'),
  });
}

export function sendUltraPurchaseEmail(to) {
  return sendEmail({
    to,
    subject: 'You\'ve got MK ULTRA!',
    text: [
      'Thanks for buying MK ULTRA!',
      '',
      'On top of everything MK PLUS includes, your account now also has:',
      '- Free Mega Chat creation, no charge',
      '- Permanent Mini Chats whenever you\'re a member',
      '- An emoji picker in the message box',
      '- The ability to like messages',
      '- An ULTRA badge next to your name',
      '',
      'Open MK to see it in action.',
    ].join('\n'),
  });
}

export function sendMegaChatPurchaseEmail(to, { serverName, amountCents, channelName }) {
  const amount = (amountCents / 100).toFixed(2);
  return sendEmail({
    to,
    subject: `Your Mega Chat "${serverName}" is ready!`,
    text: [
      `Your Mega Chat "${serverName}" has been created and is ready to use.`,
      '',
      `Amount charged: $${amount}`,
      `First channel: #${channelName}`,
      '',
      'You\'re the owner, so you can create more channels, add members by',
      'username, and manage things from inside MK.',
      '',
      'Open MK to check it out.',
    ].join('\n'),
  });
}
