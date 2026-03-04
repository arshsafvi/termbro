// api/auth/status.js
// Extension calls this to get current user tier and scan count

import { supabase } from '../../lib/supabase.js';

const FREE_LIMIT = 3;
const PAID_LIMIT = 50;

function getMondayDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check weekly reset
  const resetAt = new Date(user.scans_reset_at);
  const monday = getMondayDate();
  let scansUsed = user.scans_used;

  if (resetAt < monday) {
    await supabase
      .from('users')
      .update({ scans_used: 0, scans_reset_at: monday.toISOString() })
      .eq('id', user.id);
    scansUsed = 0;
  }

  const limit = user.tier === 'paid' ? PAID_LIMIT : FREE_LIMIT;

  return res.status(200).json({
    email: user.email,
    tier: user.tier,
    scans_used: scansUsed,
    limit,
    remaining: Math.max(0, limit - scansUsed)
  });
}
