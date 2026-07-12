export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serpKey = process.env.SERPAPI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!serpKey) {
    return res.status(500).json({ error: 'SERPAPI_API_KEY is not configured in Vercel.' });
  }

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    return res.status(400).json({ error: 'Enter a business search request.' });
  }

  let mapsQuery = query;

  if (openaiKey) {
    try {
      const aiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          instructions: 'Convert the request into one concise Google Maps business search query. Preserve the business type and location. Remove conditions such as minimum reviews, rating, no website, has phone, or outdated website because the application filters those separately. Return only the search query.',
          input: query,
          max_output_tokens: 80
        })
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const text = aiData.output_text?.trim();
        if (text) mapsQuery = text;
      }
    } catch (error) {
      console.error('OpenAI query parsing failed; using original query.', error);
    }
  }

  try {
    const params = new URLSearchParams({
      engine: 'google_maps',
      q: mapsQuery,
      api_key: serpKey,
      hl: 'en'
    });

    const serpResponse = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    const serpData = await serpResponse.json().catch(() => ({}));

    if (!serpResponse.ok || serpData.error) {
      return res.status(502).json({
        error: serpData.error || `SerpAPI request failed with status ${serpResponse.status}.`
      });
    }

    const businesses = Array.isArray(serpData.local_results) ? serpData.local_results : [];

    return res.status(200).json({
      query: mapsQuery,
      businesses,
      count: businesses.length
    });
  } catch (error) {
    console.error('SerpAPI search failed.', error);
    return res.status(502).json({ error: 'Unable to contact SerpAPI.' });
  }
}
