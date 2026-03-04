// api/webhook/dodo.js
// Handles Dodo Payments webhooks — upgrades user tier on successful subscription

import { supabase } from '../../lib/supabase.js';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: false } // Need raw body for signature verification
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return `sha256=${expected}` === signature;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const signature = req.headers['webhook-signature'] || req.headers['x-dodo-signature'] || '';

  // Verify webhook authenticity
  if (process.env.DODO_WEBHOOK_SECRET) {
    const valid = verifySignature(rawBody, signature, process.env.DODO_WEBHOOK_SECRET);
    if (!valid) {
      console.error('[TermBro Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('[TermBro Webhook] Event received:', event.type);

  const email = event?.data?.customer?.email
    || event?.data?.metadata?.email
    || null;

  const subscriptionId = event?.data?.id || null;
  const customerId = event?.data?.customer?.id || null;

  switch (event.type) {

    // Subscription activated — upgrade user to paid
    case 'subscription.active':
    case 'payment.succeeded':
      if (email) {
        const { error } = await supabase
          .from('users')
          .upsert({
            email,
            tier: 'paid',
            dodo_customer_id: customerId,
            dodo_subscription_id: subscriptionId,
            scans_used: 0,
            scans_reset_at: new Date().toISOString()
          }, { onConflict: 'email' });

        if (error) {
          console.error('[TermBro Webhook] Supabase error:', error.message);
          return res.status(500).json({ error: error.message });
        }

        console.log('[TermBro Webhook] Upgraded to paid:', email);
      }
      break;

    // Subscription cancelled or failed — downgrade to free
    case 'subscription.cancelled':
    case 'subscription.failed':
    case 'subscription.expired':
      if (email) {
        await supabase
          .from('users')
          .update({ tier: 'free' })
          .eq('email', email);

        console.log('[TermBro Webhook] Downgraded to free:', email);
      }
      break;

    default:
      console.log('[TermBro Webhook] Unhandled event type:', event.type);
  }

  return res.status(200).json({ received: true });
}
