module.exports = function handler(req, res) {
  res.status(200).json({
    ok: true,
    searchRoute: '/api/search',
    serpapiConfigured: Boolean(process.env.SERPAPI_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
};
