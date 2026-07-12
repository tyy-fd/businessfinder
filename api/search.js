module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed. Send a POST request to /api/search.'
    });
  }

  const serpKey = process.env.SERPAPI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!serpKey) {
    return res.status(500).json({
      error: 'SERPAPI_API_KEY is missing from the Vercel project environment variables.'
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
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
          instructions: 'Convert the user request into one concise Google Maps search query. Keep only the business type and location. Remove filtering requirements such as ratings, review counts, website status and phone availability. Return only the search query.',
          input: query,
          max_output_tokens: 80
        })
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const parsed = typeof aiData.output_text === 'string' ? aiData.output_text.trim() : '';
        if (parsed) mapsQuery = parsed;
      } else {
        console.error('OpenAI returned', aiResponse.status, await aiResponse.text());
      }
    } catch (error) {
      console.error('OpenAI parsing failed; original query will be used.', error);
    }
  }

  try {
    const params = new URLSearchParams({
      engine: 'google_maps',
      q: mapsQuery,
      api_key: serpKey,
      hl: 'en',
      gl: 'uk'
    });

    const serpResponse = await fetch(`https://serpapi.com/search.json?${params}`);
    const rawText = await serpResponse.text();
    let serpData = {};

    try { serpData = JSON.parse(rawText); } catch (_) {}

    if (!serpResponse.ok || serpData.error) {
      return res.status(502).json({
        error: serpData.error || `SerpAPI returned HTTP ${serpResponse.status}.`
      });
    }

    const businesses = Array.isArray(serpData.local_results)
      ? serpData.local_results
      : [];

    return res.status(200).json({
      query: mapsQuery,
      businesses,
      count: businesses.length
    });
  } catch (error) {
    console.error('SerpAPI request failed.', error);
    return res.status(502).json({ error: 'The server could not contact SerpAPI.' });
  }
};
