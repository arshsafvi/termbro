// api/analyse/index.js
// Proxies the Gemini API call — keeps key server-side
// Also enforces scan limits via Supabase

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, url, email } = req.body;

  if (!text || !url) {
    return res.status(400).json({ error: 'Missing text or url' });
  }

  // ── USAGE TRACKING ────────────────────────────────────────────────────────
  let userTier = 'free';
  let userId = null;

  if (email) {
    // Get or create user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ email, tier: 'free', scans_used: 0, scans_reset_at: new Date().toISOString() })
        .select()
        .single();
      user = newUser;
    }

    if (user) {
      userId = user.id;
      userTier = user.tier;

      // Check weekly reset
      const resetAt = new Date(user.scans_reset_at);
      const monday = getMondayDate();
      if (resetAt < monday) {
        await supabase
          .from('users')
          .update({ scans_used: 0, scans_reset_at: monday.toISOString() })
          .eq('id', userId);
        user.scans_used = 0;
      }

      // Enforce limits
      const limit = userTier === 'paid' ? PAID_LIMIT : FREE_LIMIT;
      if (user.scans_used >= limit) {
        return res.status(429).json({
          error: 'scan_limit_reached',
          tier: userTier,
          limit
        });
      }

      // Increment scan count
      await supabase
        .from('users')
        .update({ scans_used: user.scans_used + 1 })
        .eq('id', userId);
    }
  }

  // ── GEMINI API CALL ───────────────────────────────────────────────────────
  const tokenEstimate = Math.ceil(text.length / 4);
  const modelId = tokenEstimate > 6000
    ? 'gemini-3.1-pro-preview'
    : 'gemini-3.1-flash-lite-preview';

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `You are TermBro, an AI that analyses Terms of Service and Privacy Policies.
Help everyday users understand what they are agreeing to.

Respond ONLY with valid JSON. No markdown, no backticks, no preamble whatsoever.

Required JSON structure:
{
  "summary": "2-3 sentence plain English summary",
  "invasiveness_score": <number 1-100>,
  "risk_level": "high" or "medium" or "low",
  "conditions": [
    {
      "title": "Short clause title",
      "description": "Plain English explanation in 1-2 sentences",
      "severity": "critical" or "high" or "medium" or "low",
      "invasiveness_score": <number 1-100>
    }
  ]
}

Rules:
- Sort conditions from MOST invasive to LEAST invasive
- Maximum 8 conditions
- Plain English only, no legal jargon
- Be direct and honest

Analyse this Terms of Service from ${url}:

${text.slice(0, 28000)}`;

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4000 }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      return res.status(500).json({ error: err?.error?.message || 'Gemini API error' });
    }

    const data = await geminiRes.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/gi, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json({ success: true, data: result, tier: userTier });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
