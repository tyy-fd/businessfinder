# LeadGenius – Vercel deployment

Keep these files at the top level of the GitHub repository:

- `index.html`
- `vercel.json`
- `package.json`
- `api/search.js`
- `api/health.js`

In Vercel add:

- `SERPAPI_API_KEY` — required
- `OPENAI_API_KEY` — optional

After deployment, open `/api/health`. It should show `ok: true` and confirm whether each key is configured. Opening `/api/search` directly should return a 405 response, which proves that the backend route exists. The app itself sends the required POST request.
