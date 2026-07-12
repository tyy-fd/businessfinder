/**
 * BUSINESS FINDER — SINGLE-FILE APP
 *
 * SECURITY:
 * Never paste API keys into this file.
 *
 * Run on macOS/Linux:
 *   SERPAPI_API_KEY="your_serpapi_key" OPENAI_API_KEY="your_openai_key" node server.js
 *
 * Run on Windows PowerShell:
 *   $env:SERPAPI_API_KEY="your_serpapi_key"
 *   $env:OPENAI_API_KEY="your_openai_key"
 *   node server.js
 *
 * Then open:
 *   http://localhost:3000
 *
 * Requirements:
 *   Node.js 18 or newer. No npm install required.
 */

const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseWebsite(value) {
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.toString();
  } catch {
    return "";
  }
}

async function callOpenAI(messages, temperature = 0.1) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature,
      response_format: { type: "json_object" },
      messages
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const payload = JSON.parse(text);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");
  return JSON.parse(content);
}

async function interpretQuery(query) {
  const fallback = parseQueryLocally(query);
  if (!OPENAI_API_KEY || !query.trim()) return fallback;

  try {
    const result = await callOpenAI([
      {
        role: "system",
        content: `Convert a local-business lead search into JSON.
Return only a JSON object with:
category:string, location:string, radiusMiles:number|null, minRating:number|null,
minReviews:number|null, maxReviews:number|null, websiteStatus:"any"|"has"|"none"|"outdated",
hasPhone:boolean|null, currentlyOpen:boolean|null, sortBy:"opportunity"|"rating"|"reviews".
Do not invent a location or category.`
      },
      { role: "user", content: query }
    ]);

    return {
      category: String(result.category || fallback.category || ""),
      location: String(result.location || fallback.location || ""),
      radiusMiles: numberOrNull(result.radiusMiles ?? fallback.radiusMiles),
      minRating: numberOrNull(result.minRating ?? fallback.minRating),
      minReviews: integerOrNull(result.minReviews ?? fallback.minReviews),
      maxReviews: integerOrNull(result.maxReviews ?? fallback.maxReviews),
      websiteStatus: ["any", "has", "none", "outdated"].includes(result.websiteStatus)
        ? result.websiteStatus
        : fallback.websiteStatus,
      hasPhone: booleanOrNull(result.hasPhone ?? fallback.hasPhone),
      currentlyOpen: booleanOrNull(result.currentlyOpen ?? fallback.currentlyOpen),
      sortBy: ["opportunity", "rating", "reviews"].includes(result.sortBy)
        ? result.sortBy
        : fallback.sortBy
    };
  } catch (error) {
    console.warn("OpenAI query parsing failed; using local parser:", error.message);
    return fallback;
  }
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integerOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function parseQueryLocally(query) {
  const text = String(query || "").toLowerCase();
  const categories = [
    "electricians", "electrician", "plumbers", "plumber", "roofers", "roofer",
    "barbers", "barber", "dentists", "dentist", "garages", "garage",
    "builders", "builder", "landscapers", "landscaper", "restaurants",
    "accountants", "accountant", "solicitors", "solicitor", "cleaners", "cleaner"
  ];

  const category = categories.find(c => text.includes(c)) || "";
  const locationMatch =
    query.match(/\b(?:in|near|around)\s+([a-zA-Z][a-zA-Z\s'-]{1,45}?)(?=\s+(?:with|that|which|within|and|more|less|at|no|without|open|$)|$)/i);

  const minRatingMatch = text.match(/(?:at least|minimum|more than|above)\s*(\d(?:\.\d)?)\s*(?:stars?|rating)?/);
  const minReviewsMatch = text.match(/(?:more than|over|at least|minimum)\s*(\d+)\s*reviews?/);
  const maxReviewsMatch = text.match(/(?:fewer than|less than|under|maximum)\s*(\d+)\s*reviews?/);
  const radiusMatch = text.match(/within\s*(\d+(?:\.\d+)?)\s*miles?/);

  let websiteStatus = "any";
  if (/(no website|without (?:a )?website|do not have (?:a )?website|does not have (?:a )?website)/.test(text)) {
    websiteStatus = "none";
  } else if (/(outdated website|old website|needs? a new website)/.test(text)) {
    websiteStatus = "outdated";
  } else if (/(has a website|with a website)/.test(text)) {
    websiteStatus = "has";
  }

  return {
    category,
    location: locationMatch ? locationMatch[1].trim() : "",
    radiusMiles: radiusMatch ? Number(radiusMatch[1]) : null,
    minRating: minRatingMatch ? Number(minRatingMatch[1]) : null,
    minReviews: minReviewsMatch ? Number(minReviewsMatch[1]) : null,
    maxReviews: maxReviewsMatch ? Number(maxReviewsMatch[1]) : null,
    websiteStatus,
    hasPhone: /(?:has|with) (?:a )?phone/.test(text) ? true : null,
    currentlyOpen: /(?:currently open|open now)/.test(text) ? true : null,
    sortBy: text.includes("sort by rating")
      ? "rating"
      : text.includes("sort by reviews")
        ? "reviews"
        : "opportunity"
  };
}

function mergeFilters(parsed, manual) {
  const result = { ...parsed };
  const keys = [
    "category", "location", "radiusMiles", "minRating", "minReviews",
    "maxReviews", "websiteStatus", "hasPhone", "currentlyOpen", "sortBy"
  ];

  for (const key of keys) {
    const value = manual?.[key];
    const hasValue =
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "auto";

    if (hasValue) {
      if (["radiusMiles", "minRating", "minReviews", "maxReviews"].includes(key)) {
        result[key] = Number(value);
      } else if (["hasPhone", "currentlyOpen"].includes(key)) {
        result[key] = value === true || value === "true";
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

async function searchSerpApi(filters, start = 0) {
  if (!SERPAPI_API_KEY) throw new Error("SERPAPI_API_KEY is not configured.");

  let q = [filters.category, filters.location].filter(Boolean).join(" in ");
  if (filters.radiusMiles) q += ` within ${filters.radiusMiles} miles`;
  if (!q) throw new Error("Add a business category, a location, or both.");

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "search");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", SERPAPI_API_KEY);
  url.searchParams.set("start", String(start));

  if (filters.currentlyOpen === true) {
    url.searchParams.set("open_now", "true");
  }

  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SerpAPI request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  if (payload.error) throw new Error(payload.error);

  return {
    localResults: Array.isArray(payload.local_results) ? payload.local_results : [],
    searchMetadata: payload.search_metadata || {},
    serpPagination: payload.serpapi_pagination || {}
  };
}

function inferOpeningStatus(item) {
  const hours = item.hours || item.operating_hours || {};
  if (typeof item.open_state === "string") return item.open_state;
  if (typeof item.open === "boolean") return item.open ? "Open" : "Closed";
  if (typeof hours === "string") return hours;
  return "Unknown";
}

function hasIncompleteDetails(item) {
  return !item.phone || !item.address || !item.type;
}

async function inspectWebsite(website) {
  const url = normaliseWebsite(website);
  if (!url) return { assessed: false, outdated: false, indicators: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const started = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BusinessFinder/1.0)"
      }
    });

    const loadMs = Date.now() - started;
    const html = (await response.text()).slice(0, 500_000);
    const indicators = [];

    if (!response.url.startsWith("https://")) indicators.push("No HTTPS");
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) indicators.push("No mobile viewport tag");
    if (!/(tel:|mailto:|contact)/i.test(html)) indicators.push("No obvious contact link");
    if (!/(book|quote|call|contact|enquire|get started|request)/i.test(html)) indicators.push("No clear call to action");
    if (loadMs > 3500) indicators.push("Slow initial response");

    const years = [...html.matchAll(/(?:©|copyright)[^0-9]{0,20}(20\d{2})/gi)]
      .map(match => Number(match[1]))
      .filter(year => year >= 2000 && year <= new Date().getFullYear());

    if (years.length && Math.max(...years) <= new Date().getFullYear() - 4) {
      indicators.push(`Old copyright year (${Math.max(...years)})`);
    }

    if (!response.ok) indicators.push(`Homepage returned HTTP ${response.status}`);

    return {
      assessed: true,
      outdated: indicators.length >= 2,
      indicators,
      loadMs
    };
  } catch (error) {
    return {
      assessed: false,
      outdated: false,
      indicators: [],
      error: error.name === "AbortError" ? "Website check timed out" : "Website could not be checked"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreLead(item, assessment) {
  let score = 0;
  const reasons = [];

  if (!item.website) {
    score += 40;
    reasons.push("No website (+40)");
  } else if (assessment?.outdated) {
    score += 30;
    reasons.push("Estimated outdated website (+30)");
  }

  const reviews = Number(item.reviews || 0);
  if (reviews > 50) {
    score += 20;
    reasons.push("More than 50 reviews (+20)");
  }
  if (reviews > 100) {
    score += 5;
    reasons.push("More than 100 reviews (+5)");
  }

  const rating = Number(item.rating || 0);
  if (rating > 4) {
    score += 10;
    reasons.push("Rating above 4 (+10)");
  }

  if (item.phone) {
    score += 5;
    reasons.push("Phone number available (+5)");
  }

  if (hasIncompleteDetails(item)) {
    score += 5;
    reasons.push("Incomplete online details (+5)");
  }

  return {
    score: clamp(score, 0, 100),
    reasons: reasons.length ? reasons : ["Limited opportunity signals found"]
  };
}

function mapsLink(item) {
  return item.links?.directions ||
    item.links?.place ||
    item.place_id_search ||
    item.google_maps_url ||
    (item.place_id ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(item.place_id)}` : "");
}

async function processResults(items, filters) {
  const unique = [];
  const seen = new Set();

  for (const item of items) {
    const key = item.place_id || `${item.title}|${item.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const shouldInspect = filters.websiteStatus === "outdated";
  const limited = unique.slice(0, 20);

  const results = await Promise.all(limited.map(async item => {
    const assessment = shouldInspect && item.website
      ? await inspectWebsite(item.website)
      : { assessed: false, outdated: false, indicators: [] };

    const score = scoreLead(item, assessment);
    return {
      id: item.place_id || crypto.randomUUID(),
      name: item.title || "Unnamed business",
      category: item.type || item.types?.[0] || "",
      phone: item.phone || "",
      website: normaliseWebsite(item.website),
      rating: Number(item.rating || 0),
      reviews: Number(item.reviews || 0),
      address: item.address || "",
      openingStatus: inferOpeningStatus(item),
      mapsUrl: mapsLink(item),
      thumbnail: item.thumbnail || "",
      leadScore: score.score,
      leadReasons: score.reasons,
      assessment,
      labels: {
        noWebsite: !item.website,
        outdatedWebsite: Boolean(assessment.outdated),
        strongReviews: Number(item.reviews || 0) > 50,
        incompleteInfo: hasIncompleteDetails(item)
      }
    };
  }));

  let filtered = results.filter(item => {
    if (filters.minRating != null && item.rating < filters.minRating) return false;
    if (filters.minReviews != null && item.reviews < filters.minReviews) return false;
    if (filters.maxReviews != null && item.reviews > filters.maxReviews) return false;
    if (filters.hasPhone === true && !item.phone) return false;
    if (filters.websiteStatus === "none" && item.website) return false;
    if (filters.websiteStatus === "has" && !item.website) return false;
    if (filters.websiteStatus === "outdated" && !item.assessment.outdated) return false;
    if (filters.currentlyOpen === true && !/open/i.test(item.openingStatus)) return false;
    return true;
  });

  const sorters = {
    opportunity: (a, b) => b.leadScore - a.leadScore || b.reviews - a.reviews,
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews || b.rating - a.rating
  };

  filtered.sort(sorters[filters.sortBy] || sorters.opportunity);
  return filtered;
}

async function generateOutreach(business) {
  if (!OPENAI_API_KEY) {
    return `Hi ${business.name}, I came across your business online and noticed there may be an opportunity to improve your website and online presence. I build clean, modern websites for local businesses. Would you be open to a quick chat?`;
  }

  const data = await callOpenAI([
    {
      role: "system",
      content: `Write a short personalised WhatsApp outreach message for a local business.
Use only the supplied business information.
Do not claim you inspected anything that is not explicitly provided.
Do not sound spammy.
Return JSON: {"message":"..."}.`
    },
    {
      role: "user",
      content: JSON.stringify({
        businessName: business.name,
        category: business.category,
        address: business.address,
        rating: business.rating,
        reviews: business.reviews,
        hasWebsite: Boolean(business.website),
        websiteAssessmentIndicators: business.assessment?.indicators || []
      })
    }
  ], 0.5);

  return String(data.message || "");
}

const HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Business Finder</title>
  <style>
    :root {
      --bg: #f5f6f8;
      --panel: rgba(255,255,255,.88);
      --text: #14171c;
      --muted: #6f7580;
      --border: #e2e5ea;
      --dark: #111318;
      --soft: #eef0f4;
      --green: #18794e;
      --amber: #9a6700;
      --red: #c9372c;
      --shadow: 0 24px 70px rgba(20, 23, 28, .08);
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 50% -10%, rgba(255,255,255,.96), transparent 38%),
        linear-gradient(180deg, #f9fafb 0%, var(--bg) 100%);
      min-height: 100vh;
    }

    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }

    .topbar {
      height: 68px;
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(226,229,234,.85);
      background: rgba(249,250,251,.78);
      backdrop-filter: blur(16px);
      position: sticky;
      top: 0;
      z-index: 20;
    }

    .brand { display: flex; align-items: center; gap: 11px; font-weight: 800; }
    .logo {
      width: 31px; height: 31px; border-radius: 10px;
      display: grid; place-items: center;
      background: var(--dark); color: white;
      box-shadow: 0 8px 18px rgba(17,19,24,.18);
    }

    .nav { display: flex; gap: 8px; }
    .nav button {
      border: 0; background: transparent; color: var(--muted);
      padding: 10px 14px; border-radius: 12px; font-weight: 650;
    }
    .nav button.active { background: white; color: var(--text); box-shadow: 0 4px 14px rgba(20,23,28,.07); }

    main { max-width: 1320px; margin: 0 auto; padding: 44px 24px 80px; }
    .hero { max-width: 900px; margin: 45px auto 34px; text-align: center; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px;
      color: var(--muted); background: rgba(255,255,255,.7); font-size: 13px; font-weight: 700;
    }
    h1 { font-size: clamp(40px, 7vw, 72px); line-height: .98; letter-spacing: -.055em; margin: 22px 0 18px; }
    .hero p { color: var(--muted); font-size: 17px; line-height: 1.65; margin: 0 auto; max-width: 670px; }

    .search-shell {
      margin: 34px auto 0; max-width: 980px;
      background: var(--panel); border: 1px solid var(--border); border-radius: 24px;
      padding: 12px; box-shadow: var(--shadow); backdrop-filter: blur(18px);
    }
    .search-row { display: flex; gap: 10px; }
    .search-row input {
      flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      padding: 17px 15px; font-size: 17px;
    }
    .btn {
      border: 0; border-radius: 14px; padding: 13px 17px; font-weight: 750;
      background: var(--dark); color: white;
    }
    .btn.secondary { background: var(--soft); color: var(--text); }
    .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    .btn.small { padding: 9px 12px; border-radius: 10px; font-size: 13px; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }

    .examples { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px; }
    .example {
      border: 1px solid var(--border); background: rgba(255,255,255,.7); color: var(--muted);
      border-radius: 999px; padding: 8px 12px; font-size: 12px;
    }

    .filters {
      display: none; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 13px;
      padding: 16px 5px 5px; border-top: 1px solid var(--border); margin-top: 10px;
    }
    .filters.open { display: grid; }
    .field label {
      display: block; color: var(--muted); font-size: 11px; font-weight: 800;
      text-transform: uppercase; letter-spacing: .07em; margin: 0 0 7px 2px;
    }
    .field input, .field select, .field textarea {
      width: 100%; border: 1px solid var(--border); background: white; color: var(--text);
      border-radius: 12px; padding: 11px 12px; outline: 0;
    }

    .status {
      max-width: 980px; margin: 22px auto 0; padding: 13px 15px; border-radius: 14px;
      background: white; border: 1px solid var(--border); color: var(--muted); display: none;
    }
    .status.show { display: block; }
    .status.error { color: var(--red); border-color: rgba(201,55,44,.25); background: #fff8f7; }

    .results-head {
      margin: 48px 0 18px; display: flex; justify-content: space-between; align-items: end; gap: 16px;
    }
    .results-head h2 { margin: 0; font-size: 28px; letter-spacing: -.03em; }
    .results-head p { color: var(--muted); margin: 5px 0 0; }

    .results { display: grid; gap: 14px; }
    .result-card {
      background: rgba(255,255,255,.9); border: 1px solid var(--border);
      border-radius: 19px; padding: 20px; box-shadow: 0 12px 35px rgba(20,23,28,.045);
    }
    .result-top { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
    .business h3 { margin: 0 0 7px; font-size: 20px; letter-spacing: -.025em; }
    .meta { color: var(--muted); font-size: 14px; line-height: 1.55; }
    .score {
      flex: 0 0 auto; width: 76px; height: 76px; border-radius: 20px;
      display: grid; place-items: center; background: var(--dark); color: white;
      font-weight: 850; font-size: 22px;
    }
    .score small { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; opacity: .65; }

    .badges { display: flex; flex-wrap: wrap; gap: 7px; margin: 14px 0; }
    .badge { border-radius: 999px; padding: 6px 9px; font-size: 11px; font-weight: 750; background: var(--soft); }
    .badge.good { color: var(--green); background: #eefbf5; }
    .badge.warn { color: var(--amber); background: #fff8e6; }
    .badge.bad { color: var(--red); background: #fff1ef; }

    .details {
      display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px;
      margin: 15px 0; padding: 15px; border-radius: 14px; background: #f8f9fb;
    }
    .detail span { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: .06em; margin-bottom: 4px; }
    .detail strong { font-size: 13px; word-break: break-word; }

    .reason { color: var(--muted); font-size: 13px; line-height: 1.55; margin: 12px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }

    .empty {
      border: 1px dashed #ccd1d8; border-radius: 20px; padding: 60px 25px; text-align: center;
      color: var(--muted); background: rgba(255,255,255,.55);
    }

    .saved-layout { display: none; }
    .saved-layout.active { display: block; }
    .search-layout.hidden { display: none; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(10,12,16,.52); display: none;
      align-items: center; justify-content: center; padding: 20px; z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      width: min(620px, 100%); max-height: 88vh; overflow: auto;
      background: white; border-radius: 22px; padding: 22px; box-shadow: 0 35px 100px rgba(0,0,0,.25);
    }
    .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .modal h3 { margin: 0; font-size: 24px; }
    .modal textarea { min-height: 130px; }
    .close { border: 0; background: var(--soft); width: 34px; height: 34px; border-radius: 10px; }

    @media (max-width: 900px) {
      .filters { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .details { grid-template-columns: repeat(2, minmax(0,1fr)); }
    }
    @media (max-width: 650px) {
      .topbar { padding: 0 14px; }
      .nav button { padding: 9px 10px; font-size: 13px; }
      main { padding: 25px 14px 60px; }
      .hero { margin-top: 20px; }
      .search-row { flex-wrap: wrap; }
      .search-row input { flex-basis: 100%; }
      .search-row .btn { flex: 1; }
      .filters { grid-template-columns: 1fr; }
      .result-top { align-items: center; }
      .details { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><div class="logo">B</div> Business Finder</div>
    <nav class="nav">
      <button id="searchTab" class="active" onclick="showPage('search')">Search</button>
      <button id="savedTab" onclick="showPage('saved')">Saved leads <span id="savedCount"></span></button>
    </nav>
  </header>

  <main>
    <section id="searchLayout" class="search-layout">
      <div class="hero">
        <div class="eyebrow">✦ Local lead intelligence</div>
        <h1>Find businesses worth contacting.</h1>
        <p>Describe the businesses you want. The app turns your request into a Google Maps search, filters the results and scores the strongest website opportunities.</p>

        <div class="search-shell">
          <div class="search-row">
            <input id="query" placeholder="Find electricians in Bromley with more than 30 reviews and no website">
            <button class="btn secondary" onclick="toggleFilters()">Filters</button>
            <button class="btn" id="searchBtn" onclick="searchBusinesses()">Search</button>
          </div>

          <div id="filters" class="filters">
            <div class="field"><label>Business category</label><input id="category" placeholder="Electricians"></div>
            <div class="field"><label>Location</label><input id="location" placeholder="Bromley"></div>
            <div class="field"><label>Radius (miles)</label><input id="radiusMiles" type="number" min="1" max="100" placeholder="10"></div>
            <div class="field"><label>Minimum rating</label><input id="minRating" type="number" min="0" max="5" step=".1" placeholder="4.0"></div>
            <div class="field"><label>Minimum reviews</label><input id="minReviews" type="number" min="0" placeholder="30"></div>
            <div class="field"><label>Maximum reviews</label><input id="maxReviews" type="number" min="0" placeholder="Any"></div>
            <div class="field"><label>Website</label>
              <select id="websiteStatus">
                <option value="auto">Use search text</option>
                <option value="any">Any</option>
                <option value="has">Has website</option>
                <option value="none">No website</option>
                <option value="outdated">Potentially outdated</option>
              </select>
            </div>
            <div class="field"><label>Phone number</label>
              <select id="hasPhone">
                <option value="auto">Use search text</option>
                <option value="true">Must have phone</option>
                <option value="false">Any</option>
              </select>
            </div>
            <div class="field"><label>Opening status</label>
              <select id="currentlyOpen">
                <option value="auto">Use search text</option>
                <option value="true">Currently open</option>
                <option value="false">Any</option>
              </select>
            </div>
            <div class="field"><label>Sort by</label>
              <select id="sortBy">
                <option value="auto">Use search text</option>
                <option value="opportunity">Lead opportunity</option>
                <option value="rating">Rating</option>
                <option value="reviews">Review count</option>
              </select>
            </div>
          </div>
        </div>

        <div class="examples">
          <button class="example" onclick="useExample(this)">Electricians in Bromley with no website</button>
          <button class="example" onclick="useExample(this)">Plumbers near Sidcup with outdated websites</button>
          <button class="example" onclick="useExample(this)">Roofers in London with over 50 reviews</button>
        </div>
      </div>

      <div id="status" class="status"></div>

      <div id="resultsSection" style="display:none">
        <div class="results-head">
          <div><h2>Search results</h2><p id="resultSummary"></p></div>
          <button id="loadMoreBtn" class="btn ghost" onclick="loadMore()" style="display:none">Load more</button>
        </div>
        <div id="results" class="results"></div>
      </div>
    </section>

    <section id="savedLayout" class="saved-layout">
      <div class="results-head">
        <div><h2>Saved leads</h2><p>Track contact status, notes and follow-ups.</p></div>
      </div>
      <div id="savedResults" class="results"></div>
    </section>
  </main>

  <div id="modalBackdrop" class="modal-backdrop" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3 id="modalTitle">Lead</h3><button class="close" onclick="closeModal()">✕</button></div>
      <div id="modalBody"></div>
    </div>
  </div>

<script>
  let currentResults = [];
  let currentStart = 0;
  let currentPayload = null;
  const savedLeads = JSON.parse(localStorage.getItem("businessFinderSavedLeads") || "[]");

  function qs(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function toggleFilters() {
    qs("filters").classList.toggle("open");
  }

  function useExample(button) {
    qs("query").value = button.textContent;
    searchBusinesses();
  }

  function getManualFilters() {
    return {
      category: qs("category").value.trim(),
      location: qs("location").value.trim(),
      radiusMiles: qs("radiusMiles").value,
      minRating: qs("minRating").value,
      minReviews: qs("minReviews").value,
      maxReviews: qs("maxReviews").value,
      websiteStatus: qs("websiteStatus").value,
      hasPhone: qs("hasPhone").value,
      currentlyOpen: qs("currentlyOpen").value,
      sortBy: qs("sortBy").value
    };
  }

  async function searchBusinesses(loadMore = false) {
    const query = qs("query").value.trim();
    const manualFilters = getManualFilters();

    if (!query && !manualFilters.category && !manualFilters.location) {
      showStatus("Enter a search or choose a category and location.", true);
      return;
    }

    if (!loadMore) {
      currentStart = 0;
      currentResults = [];
      currentPayload = { query, manualFilters };
    }

    setLoading(true, loadMore ? "Loading more businesses…" : "Searching Google Maps and scoring opportunities…");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentPayload,
          start: currentStart
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed.");

      currentResults = dedupeResults([...currentResults, ...data.results]);
      renderResults(currentResults);
      qs("resultSummary").textContent =
        currentResults.length + " matching businesses · sorted by " + data.filters.sortBy;
      qs("resultsSection").style.display = "block";
      qs("loadMoreBtn").style.display = data.hasMore ? "inline-flex" : "none";
      currentStart += 20;
      hideStatus();
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      setLoading(false);
    }
  }

  function loadMore() { searchBusinesses(true); }

  function dedupeResults(items) {
    const map = new Map();
    items.forEach(item => map.set(item.id || item.name + item.address, item));
    return [...map.values()];
  }

  function setLoading(loading, message) {
    qs("searchBtn").disabled = loading;
    qs("loadMoreBtn").disabled = loading;
    qs("searchBtn").textContent = loading ? "Searching…" : "Search";
    if (loading) showStatus(message);
  }

  function showStatus(message, error = false) {
    qs("status").textContent = message;
    qs("status").className = "status show" + (error ? " error" : "");
  }

  function hideStatus() {
    qs("status").className = "status";
  }

  function renderResults(results) {
    const container = qs("results");
    if (!results.length) {
      container.innerHTML = '<div class="empty"><h3>No matching businesses found</h3><p>Try widening your filters or changing the location.</p></div>';
      return;
    }
    container.innerHTML = results.map(resultCard).join("");
  }

  function resultCard(item) {
    const badges = [];
    if (item.labels.noWebsite) badges.push('<span class="badge bad">No website</span>');
    if (item.labels.outdatedWebsite) badges.push('<span class="badge warn">Estimated outdated website</span>');
    if (item.labels.strongReviews) badges.push('<span class="badge good">Strong review count</span>');
    if (item.labels.incompleteInfo) badges.push('<span class="badge warn">Incomplete information</span>');

    const assessment = item.assessment?.assessed
      ? '<div class="reason"><strong>Estimated website-quality assessment:</strong> ' +
        escapeHtml(item.assessment.indicators.length ? item.assessment.indicators.join(", ") : "No strong warning signs detected") +
        '</div>'
      : "";

    return '<article class="result-card">' +
      '<div class="result-top">' +
        '<div class="business"><h3>' + escapeHtml(item.name) + '</h3>' +
          '<div class="meta">' + escapeHtml(item.category || "Local business") + '<br>' + escapeHtml(item.address || "Address unavailable") + '</div>' +
        '</div>' +
        '<div class="score"><div>' + item.leadScore + '<small>score</small></div></div>' +
      '</div>' +
      '<div class="badges">' + badges.join("") + '</div>' +
      '<div class="details">' +
        detail("Rating", item.rating ? item.rating.toFixed(1) + " ★" : "—") +
        detail("Reviews", item.reviews || "0") +
        detail("Phone", item.phone || "—") +
        detail("Status", item.openingStatus || "Unknown") +
      '</div>' +
      '<div class="reason"><strong>Why this score:</strong> ' + escapeHtml(item.leadReasons.join(" · ")) + '</div>' +
      assessment +
      '<div class="actions">' +
        '<button class="btn small secondary" onclick="viewBusiness(\'' + encodeURIComponent(item.id) + '\')">View business</button>' +
        (item.website ? '<button class="btn small ghost" onclick="openUrl(\'' + encodeURIComponent(item.website) + '\')">Visit website</button>' : '') +
        (item.mapsUrl ? '<button class="btn small ghost" onclick="openUrl(\'' + encodeURIComponent(item.mapsUrl) + '\')">Google Maps</button>' : '') +
        (item.phone ? '<button class="btn small ghost" onclick="copyText(\'' + encodeURIComponent(item.phone) + '\')">Copy phone</button>' : '') +
        '<button class="btn small ghost" onclick="saveLead(\'' + encodeURIComponent(item.id) + '\')">Save lead</button>' +
        '<button class="btn small" onclick="generateMessage(\'' + encodeURIComponent(item.id) + '\')">Generate outreach</button>' +
      '</div>' +
    '</article>';
  }

  function detail(label, value) {
    return '<div class="detail"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function findResult(encodedId) {
    const id = decodeURIComponent(encodedId);
    return currentResults.find(x => x.id === id) || savedLeads.find(x => x.id === id);
  }

  function openUrl(encodedUrl) {
    window.open(decodeURIComponent(encodedUrl), "_blank", "noopener");
  }

  async function copyText(encodedText) {
    await navigator.clipboard.writeText(decodeURIComponent(encodedText));
    showStatus("Copied to clipboard.");
    setTimeout(hideStatus, 1800);
  }

  function viewBusiness(encodedId) {
    const item = findResult(encodedId);
    if (!item) return;
    openModal(item.name,
      '<div class="details">' +
        detail("Category", item.category || "—") +
        detail("Phone", item.phone || "—") +
        detail("Rating", item.rating ? item.rating.toFixed(1) : "—") +
        detail("Reviews", item.reviews || 0) +
        detail("Address", item.address || "—") +
        detail("Status", item.openingStatus || "Unknown") +
        detail("Lead score", item.leadScore + "/100") +
        detail("Website", item.website || "None") +
      '</div><div class="reason">' + escapeHtml(item.leadReasons.join(" · ")) + '</div>'
    );
  }

  function saveLead(encodedId) {
    const item = findResult(encodedId);
    if (!item) return;
    if (savedLeads.some(x => x.id === item.id)) {
      showStatus("This lead is already saved.");
      setTimeout(hideStatus, 1800);
      return;
    }

    savedLeads.unshift({
      ...item,
      notes: "",
      contactStatus: "Not contacted",
      dateAdded: new Date().toISOString(),
      followUpDate: ""
    });
    persistSaved();
    showStatus("Lead saved.");
    setTimeout(hideStatus, 1800);
  }

  async function generateMessage(encodedId) {
    const item = findResult(encodedId);
    if (!item) return;
    openModal("Generating outreach…", "<p>Please wait while the message is created.</p>");

    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business: item })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Message generation failed.");

      openModal("Outreach for " + item.name,
        '<div class="field"><label>WhatsApp message</label><textarea id="outreachText">' +
        escapeHtml(data.message) +
        '</textarea></div><button class="btn" onclick="copyOutreach()">Copy message</button>'
      );
    } catch (error) {
      openModal("Could not generate message", "<p>" + escapeHtml(error.message) + "</p>");
    }
  }

  async function copyOutreach() {
    await navigator.clipboard.writeText(qs("outreachText").value);
    closeModal();
    showStatus("Outreach message copied.");
    setTimeout(hideStatus, 1800);
  }

  function openModal(title, body) {
    qs("modalTitle").textContent = title;
    qs("modalBody").innerHTML = body;
    qs("modalBackdrop").classList.add("open");
  }

  function closeModal(event) {
    if (event && event.target !== qs("modalBackdrop")) return;
    qs("modalBackdrop").classList.remove("open");
  }

  function showPage(page) {
    const saved = page === "saved";
    qs("searchLayout").classList.toggle("hidden", saved);
    qs("savedLayout").classList.toggle("active", saved);
    qs("searchTab").classList.toggle("active", !saved);
    qs("savedTab").classList.toggle("active", saved);
    if (saved) renderSaved();
  }

  function persistSaved() {
    localStorage.setItem("businessFinderSavedLeads", JSON.stringify(savedLeads));
    updateSavedCount();
    renderSaved();
  }

  function updateSavedCount() {
    qs("savedCount").textContent = savedLeads.length ? "(" + savedLeads.length + ")" : "";
  }

  function renderSaved() {
    const container = qs("savedResults");
    if (!savedLeads.length) {
      container.innerHTML = '<div class="empty"><h3>No saved leads yet</h3><p>Save promising businesses from your search results.</p></div>';
      return;
    }

    container.innerHTML = savedLeads.map(item =>
      '<article class="result-card">' +
        '<div class="result-top"><div class="business"><h3>' + escapeHtml(item.name) + '</h3><div class="meta">' +
          escapeHtml(item.category || "") + '<br>' + escapeHtml(item.address || "") +
        '</div></div><div class="score"><div>' + item.leadScore + '<small>score</small></div></div></div>' +
        '<div class="details">' +
          '<div class="field"><label>Contact status</label><select onchange="updateSaved(\'' + encodeURIComponent(item.id) + '\', \'contactStatus\', this.value)">' +
            statusOptions(item.contactStatus) +
          '</select></div>' +
          '<div class="field"><label>Follow-up date</label><input type="date" value="' + escapeHtml(item.followUpDate || "") + '" onchange="updateSaved(\'' + encodeURIComponent(item.id) + '\', \'followUpDate\', this.value)"></div>' +
          '<div class="field"><label>Date added</label><input disabled value="' + escapeHtml(new Date(item.dateAdded).toLocaleDateString()) + '"></div>' +
          '<div class="field"><label>Phone</label><input disabled value="' + escapeHtml(item.phone || "—") + '"></div>' +
        '</div>' +
        '<div class="field"><label>Notes</label><textarea oninput="updateSaved(\'' + encodeURIComponent(item.id) + '\', \'notes\', this.value)">' + escapeHtml(item.notes || "") + '</textarea></div>' +
        '<div class="actions">' +
          '<button class="btn small" onclick="generateMessage(\'' + encodeURIComponent(item.id) + '\')">Generate outreach</button>' +
          (item.phone ? '<button class="btn small ghost" onclick="copyText(\'' + encodeURIComponent(item.phone) + '\')">Copy phone</button>' : '') +
          '<button class="btn small ghost" onclick="removeSaved(\'' + encodeURIComponent(item.id) + '\')">Remove</button>' +
        '</div>' +
      '</article>'
    ).join("");
  }

  function statusOptions(selected) {
    return ["Not contacted", "Message sent", "Replied", "Follow-up needed", "Interested", "Quoted", "Closed", "Not interested"]
      .map(status => '<option ' + (status === selected ? "selected" : "") + '>' + status + '</option>')
      .join("");
  }

  function updateSaved(encodedId, key, value) {
    const item = savedLeads.find(x => x.id === decodeURIComponent(encodedId));
    if (!item) return;
    item[key] = value;
    localStorage.setItem("businessFinderSavedLeads", JSON.stringify(savedLeads));
  }

  function removeSaved(encodedId) {
    const index = savedLeads.findIndex(x => x.id === decodeURIComponent(encodedId));
    if (index >= 0) savedLeads.splice(index, 1);
    persistSaved();
  }

  qs("query").addEventListener("keydown", event => {
    if (event.key === "Enter") searchBusinesses();
  });

  updateSavedCount();
</script>
</body>
</html>`;

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      serpApiConfigured: Boolean(SERPAPI_API_KEY),
      openAiConfigured: Boolean(OPENAI_API_KEY)
    });
  }

  if (pathname === "/api/search" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const parsed = await interpretQuery(String(body.query || ""));
      const filters = mergeFilters(parsed, body.manualFilters || {});
      const search = await searchSerpApi(filters, Number(body.start || 0));
      const results = await processResults(search.localResults, filters);

      return sendJson(res, 200, {
        filters,
        results,
        hasMore: Boolean(search.serpPagination?.next) || search.localResults.length >= 20
      });
    } catch (error) {
      console.error(error);
      const rateLimited = /429|rate limit/i.test(error.message);
      return sendJson(res, rateLimited ? 429 : 500, {
        error: rateLimited
          ? "The API rate limit was reached. Try again shortly."
          : error.message
      });
    }
  }

  if (pathname === "/api/outreach" && req.method === "POST") {
    try {
      const body = await readJson(req);
      if (!body.business?.name) throw new Error("Business data is missing.");
      const message = await generateOutreach(body.business);
      return sendJson(res, 200, { message });
    } catch (error) {
      console.error(error);
      return sendJson(res, 500, { error: error.message });
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname.startsWith("/api/")) {
    return handleApi(req, res, requestUrl.pathname);
  }

  if (requestUrl.pathname === "/" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer"
    });
    return res.end(HTML);
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\nBusiness Finder is running at http://localhost:${PORT}`);
  console.log(`SerpAPI key: ${SERPAPI_API_KEY ? "configured" : "MISSING"}`);
  console.log(`OpenAI key: ${OPENAI_API_KEY ? "configured" : "MISSING"}\n`);
});
