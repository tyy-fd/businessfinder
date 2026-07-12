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

  let parsedSearch = {
    mapsQuery: query,
    niche: '',
    area: '',
    nearbyAreas: []
  };

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
          instructions: [
            'Parse a UK local-business search request.',
            'Return valid JSON only with keys: mapsQuery, niche, area, nearbyAreas.',
            'mapsQuery must contain only the business niche and requested location.',
            'Remove filtering requirements such as ratings, reviews, website status and phone availability.',
            'nearbyAreas must contain up to 4 genuinely nearby towns, districts or neighbourhoods, excluding the requested area.',
            'Do not invent businesses. Nearby areas are only geographic suggestions.'
          ].join(' '),
          input: query,
          max_output_tokens: 220
        })
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const output = typeof aiData.output_text === 'string'
          ? aiData.output_text.trim()
          : '';

        if (output) {
          const cleaned = output
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '');

          const parsed = JSON.parse(cleaned);
          parsedSearch = {
            mapsQuery: typeof parsed.mapsQuery === 'string' && parsed.mapsQuery.trim()
              ? parsed.mapsQuery.trim()
              : query,
            niche: typeof parsed.niche === 'string' ? parsed.niche.trim() : '',
            area: typeof parsed.area === 'string' ? parsed.area.trim() : '',
            nearbyAreas: Array.isArray(parsed.nearbyAreas)
              ? parsed.nearbyAreas.filter(x => typeof x === 'string' && x.trim()).slice(0, 4)
              : []
          };
        }
      } else {
        console.error('OpenAI returned', aiResponse.status, await aiResponse.text());
      }
    } catch (error) {
      console.error('OpenAI parsing failed; original query will be used.', error);
    }
  }

  async function fetchMaps(searchQuery, start = 0) {
    const params = new URLSearchParams({
      engine: 'google_maps',
      q: searchQuery,
      api_key: serpKey,
      hl: 'en',
      gl: 'uk'
    });

    if (start > 0) params.set('start', String(start));

    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const rawText = await response.text();
    let data = {};

    try { data = JSON.parse(rawText); } catch (_) {}

    if (!response.ok || data.error) {
      throw new Error(data.error || `SerpAPI returned HTTP ${response.status}.`);
    }

    return Array.isArray(data.local_results) ? data.local_results : [];
  }

  function dedupe(items, seen) {
    const output = [];

    for (const business of items) {
      const key =
        business.place_id ||
        business.data_id ||
        `${business.title || business.name || ''}|${business.address || ''}`;

      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(business);
    }

    return output;
  }

  try {
    const seen = new Set();

    // Fetch up to two pages for the requested area.
    const firstPage = await fetchMaps(parsedSearch.mapsQuery, 0);
    let exactResults = dedupe(firstPage, seen);

    if (exactResults.length >= 15) {
      try {
        const secondPage = await fetchMaps(parsedSearch.mapsQuery, 20);
        exactResults = exactResults.concat(dedupe(secondPage, seen));
      } catch (error) {
        console.error('Second exact-area page failed.', error);
      }
    }

    exactResults = exactResults.slice(0, 40);

    const surroundingResults = [];
    const shouldExpandNearby = exactResults.length < 12;

    if (
      shouldExpandNearby &&
      parsedSearch.niche &&
      parsedSearch.nearbyAreas.length > 0
    ) {
      for (const nearbyArea of parsedSearch.nearbyAreas) {
        try {
          const nearbyQuery = `${parsedSearch.niche} in ${nearbyArea}`;
          const nearbyBusinesses = dedupe(
            await fetchMaps(nearbyQuery, 0),
            seen
          ).slice(0, 20);

          if (nearbyBusinesses.length > 0) {
            surroundingResults.push({
              area: nearbyArea,
              query: nearbyQuery,
              businesses: nearbyBusinesses
            });
          }

          if (
            surroundingResults.reduce(
              (total, group) => total + group.businesses.length,
              0
            ) >= 40
          ) {
            break;
          }
        } catch (error) {
          console.error(`Nearby search failed for ${nearbyArea}.`, error);
        }
      }
    }

    const surroundingCount = surroundingResults.reduce(
      (total, group) => total + group.businesses.length,
      0
    );

    return res.status(200).json({
      query: parsedSearch.mapsQuery,
      niche: parsedSearch.niche,
      area: parsedSearch.area || parsedSearch.mapsQuery,
      exactResults,
      surroundingResults,
      businesses: [
        ...exactResults,
        ...surroundingResults.flatMap(group => group.businesses)
      ],
      exactCount: exactResults.length,
      surroundingCount,
      count: exactResults.length + surroundingCount,
      expandedToNearbyAreas: surroundingResults.length > 0
    });
  } catch (error) {
    console.error('SerpAPI request failed.', error);
    return res.status(502).json({
      error: error.message || 'The server could not contact SerpAPI.'
    });
  }
};
