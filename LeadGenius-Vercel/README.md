# LeadGenius – Vercel deployment

## Deploy

1. Upload every file and folder in this project to a GitHub repository.
2. Import the repository into Vercel.
3. In Vercel, open **Settings → Environment Variables**.
4. Add `SERPAPI_API_KEY` with your SerpAPI key.
5. Optionally add `OPENAI_API_KEY` for natural-language query cleanup.
6. Redeploy the project.

The browser calls `/api/search`. API credentials are read only by the Vercel Function and are never stored in the HTML or browser Local Storage.

Access password: `Corner@11`
