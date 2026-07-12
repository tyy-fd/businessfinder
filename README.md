# LeadGenius — Vercel deployment

## Repository structure

Keep these files at the top level of the GitHub repository:

- `index.html`
- `api/search.js`
- `package.json`
- `vercel.json`

Do not upload an extra parent folder around them.

## Vercel settings

1. Import the GitHub repository into Vercel.
2. Framework Preset: **Other**.
3. Root Directory: leave blank (`./`).
4. Build Command: leave blank.
5. Output Directory: leave blank.
6. Add environment variable `SERPAPI_API_KEY`.
7. Optionally add `OPENAI_API_KEY`.
8. Redeploy after saving environment variables.

The homepage is the root `index.html`, and `/api/search` is the serverless backend.
