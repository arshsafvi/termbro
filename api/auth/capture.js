// api/auth/capture.js
// Captures email, creates user if not exists, returns tier + usage

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Get or create user
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (!user) {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email,
        tier: 'free',
        scans_used: 0,
        scans_reset_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    user = newUser;
  }

  return res.status(200).json({
    success: true,
    email: user.email,
    tier: user.tier,
    scans_used: user.scans_used
  });
}
