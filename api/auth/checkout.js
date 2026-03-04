// api/auth/checkout.js
// Creates a Dodo Payments checkout session and returns the URL

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const response = await fetch('https://api.dodopayments.com/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DODO_API_KEY}`
      },
      body: JSON.stringify({
        product_id: process.env.DODO_PRODUCT_ID,
        customer: {
          email,
          create_new_customer: true
        },
        payment_link: true,
        return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/success?email=${encodeURIComponent(email)}`,
        metadata: {
          email,
          source: 'termbro_extension'
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err?.message || 'Dodo API error' });
    }

    const data = await response.json();
    return res.status(200).json({
      success: true,
      checkout_url: data.payment_link
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
