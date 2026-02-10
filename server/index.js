require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { XMLParser } = require("fast-xml-parser");
const cheerio = require("cheerio");
const crypto = require("crypto");

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const translateApiKey = process.env.GOOGLE_TRANSLATE_API_KEY || "";
const NEWS_FULLTEXT_ENABLED = String(process.env.NEWS_FULLTEXT_ENABLED || "").trim() === "1";
const NEWS_SOURCE_IMAGES_ENABLED = String(process.env.NEWS_SOURCE_IMAGES_ENABLED || "").trim() === "1";

if (!apiKey) {
  console.warn("Missing OPENAI_API_KEY. /api/summary will return 503.");
}
if (!translateApiKey) {
  console.warn("Missing GOOGLE_TRANSLATE_API_KEY. /api/translate will return 503.");
}
if (!NEWS_FULLTEXT_ENABLED) {
  console.warn("NEWS_FULLTEXT_ENABLED is off. /api/ann/article will return 403.");
}
if (!NEWS_SOURCE_IMAGES_ENABLED) {
  console.warn("NEWS_SOURCE_IMAGES_ENABLED is off. /api/ann/thumb and /api/img will return 403.");
}

const client = apiKey ? new OpenAI({ apiKey }) : null;
const summaryCache = new Map();
const jikanCache = new Map();
const jikanInflight = new Map();
const JIKAN_TTL = 2 * 60 * 1000;
const JIKAN_TOP_TTL = 5 * 60 * 1000;
const JIKAN_SEASON_TTL = 10 * 60 * 1000;
const JIKAN_DETAIL_TTL = 12 * 60 * 60 * 1000;
const STALE_MAX = 15 * 60 * 1000;
const MAX_JIKAN_CACHE = 1500;
const anilistCache = new Map();
const anilistInflight = new Map();
const ANILIST_TTL = 5 * 60 * 1000;
const MAX_ANILIST_CACHE = 1200;
const ANN_FEED_URL = "https://www.animenewsnetwork.com/news/rss.xml";
const annCache = new Map();
const newsContextCache = new Map();
const newsContextInflight = new Map();
const translateCache = new Map();
const TRANSLATE_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_TRANSLATE_CACHE = 400;
const MAX_TRANSLATE_CHARS = 20000;
const imageProxyCache = new Map();
const imageProxyInflight = new Map();
const IMAGE_PROXY_TTL = 24 * 60 * 60 * 1000;
const MAX_IMAGE_PROXY_CACHE = 220;
const ANN_TTL = 5 * 60 * 1000;
const NEWS_CONTEXT_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_NEWS_CONTEXT_CACHE = 1400;
const mangaSeasonLastPageCache = new Map();
const MANGA_SEASON_LASTPAGE_TTL = 60 * 60 * 1000;
const CATALOG_PRIMARY = String(process.env.CATALOG_PRIMARY || "anilist").trim().toLowerCase();
const DETAIL_PRIMARY = String(process.env.DETAIL_PRIMARY || CATALOG_PRIMARY || "anilist").trim().toLowerCase();
const JIKAN_FALLBACK_ENABLED = String(process.env.JIKAN_FALLBACK_ENABLED || "0").trim() === "1";

const shouldServeStale = (cached, ttl) => {
  if (!cached) return false;
  const age = Date.now() - cached.ts;
  return age > ttl && age < STALE_MAX;
};

const buildCacheKey = (title, content) => {
  const base = `${title || ""}\n${content || ""}`.trim();
  return base.slice(0, 2000);
};

const normalizeNewsTitleForSearch = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return "";
  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted && quoted[1]) return String(quoted[1]).trim();
  const splitDash = text.split(" - ").map((s) => s.trim()).filter(Boolean);
  if (splitDash.length > 1 && splitDash[0].length >= 8) return splitDash[0];
  const splitColon = text.split(":").map((s) => s.trim()).filter(Boolean);
  if (splitColon.length > 1 && splitColon[0].length >= 8) return splitColon[0];
  return text.slice(0, 140);
};

const absAnn = (value) => {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://www.animenewsnetwork.com${value}`;
  return value;
};

const absFromBase = (value, baseUrl) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("javascript:")) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  try {
    return new URL(raw, baseUrl).href;
  } catch (err) {
    return absAnn(raw);
  }
};

const stripTags = (value = "") => String(value).replace(/<[^>]+>/g, "").trim();
const cleanText = (value = "") =>
  stripTags(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();

const buildTrailerEmbedUrl = (trailer) => {
  const id = String(trailer?.id || "").trim();
  const site = String(trailer?.site || "").trim().toLowerCase();
  if (!id) return "";
  if (site === "youtube") return `https://www.youtube.com/embed/${id}`;
  if (site === "dailymotion") return `https://www.dailymotion.com/embed/video/${id}`;
  return "";
};

const decodeHtml = (value = "") => {
  // Google Translate v2 returns HTML-escaped strings.
  const raw = String(value || "");
  try {
    return cheerio.load(`<div>${raw}</div>`).text();
  } catch (err) {
    return raw
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
};

const looksEnglish = (value = "") => {
  const text = String(value || "");
  if (!text.trim()) return true;
  // If Japanese characters exist, assume not English.
  if (/[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) return false;
  // Ratio of ASCII characters as a heuristic.
  let ascii = 0;
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    total += 1;
    if (code <= 0x7f) ascii += 1;
  }
  if (!total) return true;
  return ascii / total >= 0.98;
};

const chunkText = (text, maxLen) => {
  const raw = String(text || "");
  if (raw.length <= maxLen) return [raw];
  const out = [];
  let i = 0;
  while (i < raw.length) {
    let end = Math.min(raw.length, i + maxLen);
    if (end < raw.length) {
      const window = raw.slice(i, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      if (cut > Math.floor(maxLen * 0.6)) {
        end = i + cut;
      }
    }
    out.push(raw.slice(i, end));
    i = end;
  }
  return out;
};

const looksLikeSpacerGif = (value) => {
  const v = String(value || "").toLowerCase();
  // ANN and many CMS templates use a 1x1/spacer placeholder for lazy-loaded images.
  return v.includes("/img/spacer.gif") || v.endsWith("spacer.gif") || v.includes("1x1");
};

const dedupeByKey = (items, getKey) => {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = getKey(item);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

const fetchWithTimeout = async (url, { timeoutMs = 10000, init = {} } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const getCachedMangaSeasonLastPage = (key) => {
  const cached = mangaSeasonLastPageCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > MANGA_SEASON_LASTPAGE_TTL) {
    mangaSeasonLastPageCache.delete(key);
    return null;
  }
  return cached.value;
};

const setCachedMangaSeasonLastPage = (key, value) => {
  mangaSeasonLastPageCache.set(key, { value, ts: Date.now() });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheSetBounded = (map, key, value, maxSize) => {
  map.set(key, value);
  if (map.size <= maxSize) return;
  const oldest = map.keys().next().value;
  if (oldest) {
    map.delete(oldest);
  }
};

const withInflight = (map, key, fn) => {
  if (map.has(key)) return map.get(key);
  const task = Promise.resolve().then(fn);
  map.set(key, task);
  task.finally(() => map.delete(key));
  return task;
};

const stableStringify = (value) => {
  const seen = new WeakSet();
  const walk = (input) => {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input)) return input.map(walk);
    const out = {};
    Object.keys(input)
      .sort()
      .forEach((key) => {
        out[key] = walk(input[key]);
      });
    return out;
  };
  try {
    return JSON.stringify(walk(value));
  } catch (err) {
    return JSON.stringify(value);
  }
};

const retryDelayMs = (response, attempt) => {
  let retryAfterMs = 0;
  try {
    const raw = response?.headers?.get("retry-after");
    const secs = raw ? Number(raw) : 0;
    if (Number.isFinite(secs) && secs > 0) {
      retryAfterMs = Math.floor(secs * 1000);
    }
  } catch (err) {
    retryAfterMs = 0;
  }
  const base = Math.min(5000, 650 * (attempt + 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.max(retryAfterMs, base + jitter);
};

const fetchWithRetry = async (url, { timeoutMs = 10000, init = {}, retries = 2 } = {}) => {
  let lastResponse = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { timeoutMs, init });
      lastResponse = response;
      if (response.ok) return response;
      const retryable = [429, 502, 503, 504].includes(response.status);
      if (!retryable) return response;
      await sleep(retryDelayMs(response, attempt));
    } catch (err) {
      if (err?.name === "AbortError") {
        await sleep(450 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  return lastResponse;
};

let jikanRequestChain = Promise.resolve();
let lastJikanRequestAt = 0;
const JIKAN_MIN_INTERVAL = 350;

const scheduleJikanRequest = (fn) => {
  const task = jikanRequestChain.then(fn, fn);
  jikanRequestChain = task.catch(() => {});
  return task;
};

const fetchJikanWithRetry = async (url, opts = {}) => {
  return scheduleJikanRequest(async () => {
    const now = Date.now();
    const wait = Math.max(0, JIKAN_MIN_INTERVAL - (now - lastJikanRequestAt));
    if (wait > 0) {
      await sleep(wait);
    }
    lastJikanRequestAt = Date.now();
    return fetchWithRetry(url, opts);
  });
};

let aniListRequestChain = Promise.resolve();
let lastAniListRequestAt = 0;
const ANILIST_MIN_INTERVAL = 250;

const scheduleAniListRequest = (fn) => {
  const task = aniListRequestChain.then(fn, fn);
  aniListRequestChain = task.catch(() => {});
  return task;
};

const fetchAniListWithRetry = async (url, opts = {}) => {
  return scheduleAniListRequest(async () => {
    const now = Date.now();
    const wait = Math.max(0, ANILIST_MIN_INTERVAL - (now - lastAniListRequestAt));
    if (wait > 0) {
      await sleep(wait);
    }
    lastAniListRequestAt = Date.now();
    return fetchWithRetry(url, opts);
  });
};

const fetchAniListMangaSeasonPageLen = async ({ page, perPage, start, end }) => {
  const query = `
    query ($page: Int, $perPage: Int, $start: FuzzyDateInt, $end: FuzzyDateInt) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, startDate_greater: $start, startDate_lesser: $end, sort: POPULARITY_DESC) {
          id
          startDate { year month day }
        }
      }
    }
  `;
  const variables = { page, perPage, start, end };
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchAniListWithRetry("https://graphql.anilist.co", {
      timeoutMs: 12000,
      retries: 3,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables })
      }
    });
    lastStatus = response?.status || 0;
    if (!response) {
      await sleep(650 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      const retryable = [429, 502, 503, 504].includes(response.status);
      if (!retryable) {
        throw new Error(`AniList probe failed (${response.status})`);
      }
      await sleep(650 * (attempt + 1));
      continue;
    }
    const json = await response.json().catch(() => ({}));
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      throw new Error(String(json.errors?.[0]?.message || "AniList probe error"));
    }
    const media = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
    // Keep the probe aligned with what we actually display: only items with a complete startDate.
    return media.filter((item) => {
      const sd = item?.startDate || {};
      return Number(sd.year) >= 2025 && Number(sd.month) > 0 && Number(sd.day) > 0;
    }).length;
  }
  throw new Error(`AniList probe failed (${lastStatus || "network error"})`);
};

const computeAniListMangaSeasonLastPage = async ({ start, end, perPage }) => {
  // AniList reports very large totals for this query but deep pages frequently return empty results.
  // We probe for the last non-empty page and cache it per season/year to keep the UI honest.
  const MAX_PAGE = 256;
  let low = 1;
  let high = 1;

  for (let i = 0; i < 12; i += 1) {
    const len = await fetchAniListMangaSeasonPageLen({ page: high, perPage, start, end });
    if (len === 0) {
      break;
    }
    low = high;
    high = Math.min(MAX_PAGE, high * 2);
    if (high === low) {
      return low;
    }
  }

  if (high === low) {
    return low;
  }

  // If we never found an empty page, cap at MAX_PAGE.
  const highLen = await fetchAniListMangaSeasonPageLen({ page: high, perPage, start, end });
  if (highLen > 0) {
    return high;
  }

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const len = await fetchAniListMangaSeasonPageLen({ page: mid, perPage, start, end });
    if (len === 0) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return low;
};

const seasonFromMonth = (month1to12) => {
  if ([12, 1, 2].includes(month1to12)) return "WINTER";
  if ([3, 4, 5].includes(month1to12)) return "SPRING";
  if ([6, 7, 8].includes(month1to12)) return "SUMMER";
  return "FALL";
};

const normalizeSeason = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (["winter", "spring", "summer", "fall"].includes(v)) return v;
  return "";
};

const startEndForSeason = (year, season) => {
  const y = Number(year);
  const s = normalizeSeason(season);
  if (!y || !s) return null;
  const ranges = {
    winter: { start: `${y}-01-01`, end: `${y}-03-31` },
    spring: { start: `${y}-04-01`, end: `${y}-06-30` },
    summer: { start: `${y}-07-01`, end: `${y}-09-30` },
    fall: { start: `${y}-10-01`, end: `${y}-12-31` }
  };
  return ranges[s] || null;
};

const toIsoDate = (y, m, d) => {
  if (!y || !m || !d) return "";
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
};

const isoToYear = (value) => {
  if (!value) return 0;
  const match = String(value).match(/^(\d{4})-/);
  return match ? Number(match[1]) : 0;
};

app.post("/api/summary", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({ error: "Missing OpenAI API key" });
    }

    const { title, content } = req.body || {};
    if (!title && !content) {
      return res.status(400).json({ error: "Missing content" });
    }

    const text = `${title ? `Title: ${title}` : ""}\n\n${content || ""}`.trim();
    const trimmed = text.slice(0, 4000);
    const cacheKey = buildCacheKey(title, content);

    if (summaryCache.has(cacheKey)) {
      return res.json(summaryCache.get(cacheKey));
    }

    const response = await client.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You are a news summarizer. Return JSON with keys: summary, keyPoints, whatHappened, whyItMatters, entities. " +
            "summary must be 2-3 original sentences in English that do not copy or closely paraphrase the source. " +
            "keyPoints must be an array of 3-5 short bullets. " +
            "whatHappened must be one sentence. whyItMatters must be one sentence. entities must be an array of 2-6 short proper nouns."
        },
        {
          role: "user",
          content: `Summarize this news brief in original wording:\n\n${trimmed}`
        }
      ]
    });

    const raw = response?.choices?.[0]?.message?.content || "{}";
    let parsed = { summary: "", keyPoints: [] };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = { summary: raw, keyPoints: [] };
    }

    const payload = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      whatHappened: typeof parsed.whatHappened === "string" ? parsed.whatHappened : "",
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters : "",
      entities: Array.isArray(parsed.entities) ? parsed.entities.filter((v) => typeof v === "string") : []
    };

    summaryCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("Summary error:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: "Failed to summarize",
      detail: err?.message || "Unknown error"
    });
  }
});

app.get("/api/translate/status", (req, res) => {
  return res.json({
    enabled: Boolean(translateApiKey),
    reason: translateApiKey ? "" : "missing-key"
  });
});

app.post("/api/translate", async (req, res) => {
  try {
    if (!translateApiKey) {
      return res.status(503).json({ error: "Missing Google Translate API key" });
    }
    const { title = "", content = "", target = "en" } = req.body || {};
    const safeTitle = String(title || "").trim();
    const safeContent = String(content || "").trim();
    const safeTarget = String(target || "en").trim().toLowerCase() || "en";
    if (!safeTitle && !safeContent) {
      return res.status(400).json({ error: "Missing content" });
    }
    if (safeTitle.length + safeContent.length > MAX_TRANSLATE_CHARS) {
      return res.status(413).json({ error: "Content too large to translate" });
    }

    const combined = `${safeTitle}\n${safeContent}`.trim();
    if (looksEnglish(combined) && safeTarget === "en") {
      return res.json({
        cached: true,
        usedApi: false,
        sourceLang: "en",
        targetLang: safeTarget,
        title: safeTitle,
        content: safeContent,
        chars: 0
      });
    }

    const hash = crypto
      .createHash("sha256")
      .update(`${safeTarget}\n${safeTitle}\n${safeContent}`)
      .digest("hex");
    const cacheKey = `translate|${hash}`;
    const cached = translateCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TRANSLATE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }

    const chunks = safeContent ? chunkText(safeContent, 3500) : [];
    const q = [];
    if (safeTitle) q.push(safeTitle);
    chunks.forEach((c) => q.push(c));
    const chars = q.reduce((sum, s) => sum + String(s || "").length, 0);

    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(translateApiKey)}`;
    const response = await fetchWithRetry(url, {
      timeoutMs: 12000,
      retries: 2,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          target: safeTarget,
          format: "text"
        })
      }
    });
    if (!response) {
      return res.status(502).json({ error: "Translate unavailable" });
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(json?.error?.message || "Translate failed");
      return res.status(response.status).json({ error: message });
    }
    const translations = Array.isArray(json?.data?.translations) ? json.data.translations : [];
    const detected = String(translations?.[0]?.detectedSourceLanguage || "").trim() || "unknown";
    const titleTranslated = safeTitle ? decodeHtml(translations?.[0]?.translatedText || "") : "";
    const contentParts = safeTitle ? translations.slice(1) : translations;
    const contentTranslated = contentParts.map((t) => decodeHtml(t?.translatedText || "")).join("");

    const payload = {
      cached: false,
      usedApi: true,
      sourceLang: detected,
      targetLang: safeTarget,
      title: titleTranslated || safeTitle,
      content: contentTranslated || safeContent,
      chars
    };
    cacheSetBounded(translateCache, cacheKey, { data: payload, ts: Date.now() }, MAX_TRANSLATE_CACHE);
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: "Translate failed" });
  }
});

app.post("/api/anilist", async (req, res) => {
  const { query: graphQuery, variables } = req.body || {};
  if (!graphQuery) {
    return res.status(400).json({ error: "Missing query" });
  }

  const key = `${graphQuery}::${stableStringify(variables || {})}`;
  const cached = anilistCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < ANILIST_TTL) {
    res.set("X-Cache", "HIT");
    return res.json(cached.data);
  }

  if (shouldServeStale(cached, ANILIST_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(anilistInflight, key, async () => {
      const response = await fetchAniListWithRetry("https://graphql.anilist.co", {
        timeoutMs: 12000,
        retries: 3,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ query: graphQuery, variables })
        }
      });
      if (response && response.ok) {
        const json = await response.json().catch(() => ({}));
        cacheSetBounded(anilistCache, key, { data: json, ts: Date.now() }, MAX_ANILIST_CACHE);
      }
    }).catch(() => {});
    return;
  }

  try {
    const result = await withInflight(anilistInflight, key, async () => {
      const response = await fetchAniListWithRetry("https://graphql.anilist.co", {
        timeoutMs: 12000,
        retries: 3,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ query: graphQuery, variables })
        }
      });
      if (!response) {
        const err = new Error("AniList request failed");
        err.status = 502;
        throw err;
      }
      const json = await response.json().catch(() => ({}));
      return { status: response.status, json };
    });

    if (result.status >= 200 && result.status < 300) {
      cacheSetBounded(anilistCache, key, { data: result.json, ts: Date.now() }, MAX_ANILIST_CACHE);
    } else if (result.status === 429 && cached) {
      // Prefer stale content over an outage when rate-limited.
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }

    return res.status(result.status).json(result.json);
  } catch (err) {
    console.error("AniList proxy error:", err?.message || err);
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(500).json({ error: "AniList proxy failed" });
  }
});

// Some browsers/extensions will probe API URLs via GET which can show noisy 404s in the console.
// The app uses POST for this endpoint; GET returns an empty payload.
app.get("/api/news/context", (req, res) => {
  return res.json({
    results: {},
    note: "Use POST /api/news/context with JSON: { items: [{ id, title }] }"
  });
});

app.post("/api/news/context", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.json({ results: {} });

  const take = items
    .slice(0, 20)
    .map((it) => ({
      id: String(it?.id || "").trim(),
      title: String(it?.title || "").trim()
    }))
    .filter((it) => it.id && it.title);

  if (take.length === 0) return res.json({ results: {} });

  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 1) {
        media(search: $search, sort: SEARCH_MATCH) {
          id
          idMal
          type
          format
          season
          seasonYear
          startDate { year month day }
          title { romaji english native }
          coverImage { large extraLarge color }
        }
      }
    }
  `;

  const resolveOne = async (item) => {
    const search = normalizeNewsTitleForSearch(item.title);
    if (!search) return null;
    const key = `ctx|${search.toLowerCase()}`;
    const cached = newsContextCache.get(key);
    if (cached && Date.now() - cached.ts < NEWS_CONTEXT_TTL) return cached.data;

    return withInflight(newsContextInflight, key, async () => {
      const response = await fetchAniListWithRetry("https://graphql.anilist.co", {
        timeoutMs: 12000,
        retries: 3,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables: { search } })
        }
      });
      if (!response || !response.ok) return null;
      const json = await response.json().catch(() => ({}));
      const media = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
      const first = media[0] || null;
      if (!first) {
        cacheSetBounded(newsContextCache, key, { data: null, ts: Date.now() }, MAX_NEWS_CONTEXT_CACHE);
        return null;
      }
      const cover = String(first?.coverImage?.extraLarge || first?.coverImage?.large || "").trim();
      const payload = {
        id: first.id || null,
        idMal: first.idMal || null,
        type: first.type || "",
        format: first.format || "",
        season: first.season || "",
        seasonYear: first.seasonYear || null,
        startDate: first.startDate || null,
        title: first.title || {},
        cover,
        color: String(first?.coverImage?.color || "").trim()
      };
      cacheSetBounded(newsContextCache, key, { data: payload, ts: Date.now() }, MAX_NEWS_CONTEXT_CACHE);
      return payload;
    }).catch(() => null);
  };

  try {
    const results = {};
    for (const it of take) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await resolveOne(it);
      if (ctx) results[it.id] = ctx;
    }
    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ error: "Failed to resolve context" });
  }
});

app.get("/api/ann/news", async (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 60));
  const days = Math.max(1, Math.min(180, Number(req.query?.days) || 30));
  const cacheKey = `ann-feed|${limit}|days=${days}`;
  const cached = annCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ANN_TTL) {
    return res.json(cached.data);
  }
  try {
    const response = await fetchWithTimeout(ANN_FEED_URL, { timeoutMs: 12000 });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to load ANN feed" });
    }
    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      trimValues: true
    });
    const parsed = parser.parse(xml);
    const itemsRaw = parsed?.rss?.channel?.item || [];
    const rssItems = (Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw])
      .filter(Boolean)
      .map((item) => {
        const title = item?.title || "Untitled";
        const link = item?.link || "";
        const guid = item?.guid?.["#text"] || item?.guid || link || title;
        const pubDate = item?.pubDate || "";
        const categories = Array.isArray(item?.category)
          ? item.category.filter(Boolean)
          : item?.category
          ? [item.category]
          : [];
        const description = stripTags(item?.description || "");
        return {
          id: guid,
          title,
          link,
          pubDate,
          publishedAt: (() => {
            const dt = new Date(pubDate);
            return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
          })(),
          categories,
          description,
          summary: description,
          image: "",
          sourceId: "ann",
          sourceName: "Anime News Network"
        };
      });

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const months = [];
    const cursor = new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);
    const end = new Date();
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= endMonth) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const byLink = new Map();
    rssItems.forEach((it) => {
      if (!it.link) return;
      byLink.set(it.link, it);
    });

    const parseArchive = (html, month) => {
      const $ = cheerio.load(html);
      const found = [];
      $("a").each((_, el) => {
        const href = String($(el).attr("href") || "").trim();
        const title = $(el).text().trim();
        if (!href.startsWith("/news/")) return;
        if (!title || title.length < 10) return;
        const match = href.match(/^\/news\/(\d{4}-\d{2}-\d{2})\//);
        if (!match) return;
        const day = match[1];
        const dt = new Date(`${day}T00:00:00Z`);
        if (Number.isNaN(dt.getTime())) return;
        if (dt < cutoff) return;
        const link = `https://www.animenewsnetwork.com${href}`;
        found.push({
          id: link,
          title,
          link,
          pubDate: dt.toISOString(),
          publishedAt: dt.toISOString(),
          categories: [],
          description: "",
          summary: "",
          image: "",
          sourceId: "ann",
          sourceName: "Anime News Network",
          archiveMonth: month
        });
      });
      return found;
    };

    // Pull older items from the archive to ensure we have at least N days worth of results.
    for (const month of months) {
      const archiveUrl = `https://www.animenewsnetwork.com/news/archive?month=${encodeURIComponent(month)}`;
      const archiveKey = `ann-archive|${month}`;
      let html = "";
      const cachedArchive = annCache.get(archiveKey);
      if (cachedArchive && Date.now() - cachedArchive.ts < 60 * 60 * 1000) {
        html = cachedArchive.data?.html || "";
      } else {
        // eslint-disable-next-line no-await-in-loop
        const archiveRes = await fetchWithTimeout(archiveUrl, { timeoutMs: 12000 });
        if (archiveRes.ok) {
          // eslint-disable-next-line no-await-in-loop
          html = await archiveRes.text();
          annCache.set(archiveKey, { data: { html }, ts: Date.now() });
        }
      }
      if (!html) continue;
      const archiveItems = parseArchive(html, month);
      archiveItems.forEach((it) => {
        if (!it.link) return;
        if (!byLink.has(it.link)) {
          byLink.set(it.link, it);
        }
      });
    }

    // Apply cutoff, sort, and cap.
    const windowed = Array.from(byLink.values())
      .filter((it) => {
        const iso = it.publishedAt || it.pubDate || "";
        const dt = new Date(iso);
        if (Number.isNaN(dt.getTime())) return false;
        return dt >= cutoff;
      })
      .sort((a, b) => String(b.publishedAt || b.pubDate || "").localeCompare(String(a.publishedAt || a.pubDate || "")))
      .slice(0, limit);

    const payload = { items: windowed, days, limit };
    annCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.json(payload);
  } catch (err) {
    console.error("ANN feed error:", err?.message || err);
    return res.status(502).json({ error: "ANN feed unavailable" });
  }
});

app.get("/api/ann/thumb", async (req, res) => {
  if (!NEWS_SOURCE_IMAGES_ENABLED) {
    return res.status(403).json({ error: "Source images disabled" });
  }
  const url = String(req.query?.url || "");
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "Missing url" });
  }
  const cacheKey = `ann-thumb|${url}`;
  const cached = annCache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.ts;
    const hasImage = Boolean(String(cached?.data?.image || "").trim());
    // If we cached an empty thumbnail, retry sooner so fixes/changes can take effect.
    const emptyTtl = 90 * 1000;
    if ((hasImage && age < ANN_TTL) || (!hasImage && age < emptyTtl)) {
      return res.json(cached.data);
    }
  }
  try {
    const response = await fetchWithTimeout(url, { timeoutMs: 12000 });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to load article" });
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const absolutize = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      try {
        return new URL(raw, url).toString();
      } catch (err) {
        return "";
      }
    };

    const metaImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $("link[rel=image_src]").attr("href") ||
      $("link[rel=feed_image]").attr("href") ||
      "";
    let safeImage = absolutize(metaImage);

    const isSpacer = (value) => String(value || "").includes("spacer.gif");

    if (!safeImage || isSpacer(safeImage)) {
      const meat = $(".meat").first();
      meat.find("script, style, iframe, noscript").remove();
      let found = "";
      meat.find("img").each((_, el) => {
        if (found) return;
        const $img = $(el);
        const candidate =
          $img.attr("data-src") ||
          $img.attr("data-lazy-src") ||
          $img.attr("data-original") ||
          $img.attr("data-src-large") ||
          $img.attr("src") ||
          "";
        const abs = absolutize(candidate);
        if (!abs) return;
        if (isSpacer(abs)) return;
        found = abs;
      });
      safeImage = found;
    }

    const payload = { image: safeImage && !isSpacer(safeImage) ? safeImage : "" };
    annCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.json(payload);
  } catch (err) {
    console.error("ANN thumb error:", err?.message || err);
    return res.status(502).json({ error: "ANN thumb unavailable" });
  }
});

app.get("/api/img", async (req, res) => {
  if (!NEWS_SOURCE_IMAGES_ENABLED) {
    return res.status(403).json({ error: "Source images disabled" });
  }
  const url = String(req.query?.url || "");
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "Missing url" });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return res.status(400).json({ error: "Invalid url" });
  }
  const host = String(parsed.hostname || "").toLowerCase();
  // Avoid becoming an open proxy. Expand this list only if needed.
  if (!host.endsWith("animenewsnetwork.com")) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  const key = `img|${url}`;
  const cached = imageProxyCache.get(key);
  if (cached && Date.now() - cached.ts < IMAGE_PROXY_TTL) {
    res.set("Content-Type", cached.ct);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(cached.buf);
  }

  try {
    const result = await withInflight(imageProxyInflight, key, async () => {
      const response = await fetchWithTimeout(url, {
        timeoutMs: 12000,
        init: {
          headers: {
            Accept: "image/*",
            "User-Agent": "AnimeDB/1.0 (+https://github.com/miguel3491/animeDB)"
          }
        }
      });
      if (!response.ok) {
        const err = new Error("Image fetch failed");
        err.status = response.status;
        throw err;
      }
      const ct = String(response.headers.get("content-type") || "application/octet-stream");
      if (!ct.startsWith("image/")) {
        const err = new Error("Not an image");
        err.status = 415;
        throw err;
      }
      const ab = await response.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length > 2 * 1024 * 1024) {
        const err = new Error("Image too large");
        err.status = 413;
        throw err;
      }
      const entry = { buf, ct, ts: Date.now() };
      cacheSetBounded(imageProxyCache, key, entry, MAX_IMAGE_PROXY_CACHE);
      return entry;
    });

    res.set("Content-Type", result.ct);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(result.buf);
  } catch (err) {
    const status = Number(err?.status) || 502;
    return res.status(status).json({ error: "Image unavailable" });
  }
});

app.get("/api/ann/article", async (req, res) => {
  if (!NEWS_FULLTEXT_ENABLED) {
    return res.status(403).json({
      error:
        "Full article rendering is disabled. This build only supports headline + AI summary with an external link."
    });
  }
  const url = String(req.query?.url || "");
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ error: "Missing url" });
  }
  const cacheKey = `ann-article|${url}`;
  const cached = annCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ANN_TTL) {
    return res.json(cached.data);
  }
  try {
    const response = await fetchWithTimeout(url, { timeoutMs: 12000 });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to load article" });
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().replace(/\s+-\s+News\s+-\s+Anime News Network\s*$/i, "").trim() ||
      "Untitled";
    const image =
      $('meta[property="og:image"]').attr("content") ||
      $("link[rel=image_src]").attr("href") ||
      $("link[rel=feed_image]").attr("href") ||
      "";
    const description =
      $('meta[name="description"]').attr("content") ||
      "";
    const meat = $(".meat").first();
    meat.find("script, style, iframe, noscript").remove();

    const inlineImages = [];
    const isAnnHost = (value) => {
      try {
        const u = new URL(value);
        return u.hostname.endsWith("animenewsnetwork.com");
      } catch (err) {
        return false;
      }
    };

    meat.find("img").each((_, el) => {
      const $img = $(el);
      const srcAttr = String($img.attr("src") || "").trim();
      const dataSrc =
        String(
          $img.attr("data-src") ||
            $img.attr("data-lazy-src") ||
            $img.attr("data-original") ||
            $img.attr("data-orig") ||
            $img.attr("data-echo") ||
            $img.attr("data-src-large") ||
            $img.attr("data-url") ||
            ""
        ).trim();
      const dataSrcset = String($img.attr("data-srcset") || "").trim();
      const srcset = String($img.attr("srcset") || "").trim();

      let chosen = srcAttr;
      if (!chosen || chosen.startsWith("data:") || looksLikeSpacerGif(chosen)) {
        chosen = dataSrc || chosen;
      }
      if (!chosen) {
        const pickFromSet = (value) => {
          if (!value) return "";
          const first = value.split(",")[0] || "";
          return (first.trim().split(/\s+/)[0] || "").trim();
        };
        chosen = pickFromSet(dataSrcset) || pickFromSet(srcset) || "";
      }

      const normalized = absFromBase(chosen, url);
      $img.attr("src", normalized);
      $img.removeAttr("srcset");
      $img.removeAttr("data-src");
      $img.removeAttr("data-lazy-src");
      $img.removeAttr("data-original");
      $img.removeAttr("data-orig");
      $img.removeAttr("data-echo");
      $img.removeAttr("data-src-large");
      $img.removeAttr("data-url");
      $img.removeAttr("data-srcset");
      // Some third-party hosts block embeds. We don't proxy images here (copyright/ToS risk),
      // but we do improve the chance of loading and provide metadata for the UI.
      $img.attr("loading", "lazy");
      $img.attr("decoding", "async");
      $img.attr("referrerpolicy", "no-referrer");

      if (normalized) {
        if (looksLikeSpacerGif(normalized)) {
          // Drop placeholder images that didn't have a real URL available.
          $img.remove();
          return;
        }
        const external = !isAnnHost(normalized);
        if (external) {
          $img.attr("data-external", "1");
        }
        inlineImages.push({ url: normalized, external });
      }
    });
    meat.find("a").each((_, el) => {
      const $a = $(el);
      const nextHref = absFromBase($a.attr("href"), url);
      if (nextHref) {
        $a.attr("href", nextHref);
      } else {
        $a.removeAttr("href");
      }
      $a.attr("target", "_blank");
      $a.attr("rel", "noreferrer");
    });
    const contentHtml = meat.html() || "";
    const contentText = meat.text().replace(/\s+\n/g, "\n").trim();

    const dedupedImages = dedupeByKey(inlineImages, (img) => img?.url || "");
    const payload = {
      url,
      title,
      image: absFromBase(image, url),
      description,
      contentHtml,
      contentText,
      inlineImages: dedupedImages,
      externalImageCount: dedupedImages.filter((img) => img.external).length,
      sourceName: "Anime News Network"
    };
    annCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.json(payload);
  } catch (err) {
    console.error("ANN article error:", err?.message || err);
    return res.status(502).json({ error: "ANN article unavailable" });
  }
});

app.get("/api/jikan", async (req, res) => {
  const { type = "anime", q = "", page = "1", fields = "", limit = "" } = req.query || {};
  const trimmed = String(q || "").trim();
  if (!trimmed) {
    return res.json({
      data: [],
      pagination: { current_page: 1, last_visible_page: 1, has_next_page: false }
    });
  }

  const endpoint = type === "manga" ? "manga" : "anime";
  const perPage = Math.max(1, Math.min(25, Number(limit) || 20));
  const pageNum = Math.max(1, Number(page) || 1);
  const primary = CATALOG_PRIMARY === "jikan" ? "jikan" : "anilist";

  const base = `https://api.jikan.moe/v4/${endpoint}?q=${encodeURIComponent(trimmed)}&page=${encodeURIComponent(pageNum)}`;
  const withFields = fields ? `${base}&fields=${encodeURIComponent(fields)}` : base;
  const jikanUrl = limit ? `${withFields}&limit=${encodeURIComponent(perPage)}` : withFields;
  const cacheKey = `catalog-search|primary=${primary}|type=${endpoint}|q=${trimmed}|page=${pageNum}|perPage=${perPage}|fields=${fields || ""}`;

  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $search: String, $type: MediaType) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(search: $search, type: $type, sort: SEARCH_MATCH) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                genres
                format
                episodes
                chapters
                description(asHtml: false)
                averageScore
                duration
                source
                status
                trailer { site id }
              }
            }
          }
        `;
        const variables = {
          page: pageNum,
          perPage,
          search: String(trimmed),
          type: endpoint === "manga" ? "MANGA" : "ANIME"
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList search failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const embedUrl = buildTrailerEmbedUrl(item?.trailer);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            genres: Array.isArray(item?.genres) ? item.genres.map((name) => ({ name })) : [],
            type: item?.format || null,
            episodes: endpoint === "anime" ? item?.episodes ?? null : undefined,
            chapters: endpoint === "manga" ? item?.chapters ?? null : undefined,
            synopsis: cleanText(item?.description || ""),
            score: item?.averageScore ? Number(item.averageScore) / 10 : null,
            duration: item?.duration ? `${item.duration} min per ep.` : null,
            source: item?.source || null,
            status: item?.status || null,
            trailer: embedUrl ? { embed_url: embedUrl } : null
          };
        });
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || pageNum,
            last_visible_page: pageInfo.lastPage || pageNum,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan search failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }
      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    }).catch(() => {});
    return;
  }

  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $search: String, $type: MediaType) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(search: $search, type: $type, sort: SEARCH_MATCH) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                genres
                format
                episodes
                chapters
                description(asHtml: false)
                averageScore
                duration
                source
                status
                trailer { site id }
              }
            }
          }
        `;
        const variables = {
          page: pageNum,
          perPage,
          search: String(trimmed),
          type: endpoint === "manga" ? "MANGA" : "ANIME"
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList search failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const embedUrl = buildTrailerEmbedUrl(item?.trailer);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            genres: Array.isArray(item?.genres) ? item.genres.map((name) => ({ name })) : [],
            type: item?.format || null,
            episodes: endpoint === "anime" ? item?.episodes ?? null : undefined,
            chapters: endpoint === "manga" ? item?.chapters ?? null : undefined,
            synopsis: cleanText(item?.description || ""),
            score: item?.averageScore ? Number(item.averageScore) / 10 : null,
            duration: item?.duration ? `${item.duration} min per ep.` : null,
            source: item?.source || null,
            status: item?.status || null,
            trailer: embedUrl ? { embed_url: embedUrl } : null
          };
        });
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || pageNum,
            last_visible_page: pageInfo.lastPage || pageNum,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan search failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Jikan search failed" });
  }
});

app.get("/api/jikan/season", async (req, res) => {
  const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 10));
  const page = Math.max(1, Number(req.query?.page) || 1);
  const primary = CATALOG_PRIMARY === "jikan" ? "jikan" : "anilist";
  const fields = "mal_id,title,images,aired";
  const jikanUrl = `https://api.jikan.moe/v4/seasons/now?filter=tv&limit=${encodeURIComponent(
    limit
  )}&page=${encodeURIComponent(page)}&fields=${encodeURIComponent(fields)}`;
  const cacheKey = `catalog-season-now|primary=${primary}|limit=${limit}|page=${page}`;

  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_SEASON_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const nowDate = new Date();
        const seasonYear = nowDate.getFullYear();
        const season = seasonFromMonth(nowDate.getMonth() + 1);
        const aniQuery = `
          query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                startDate { year month day }
              }
            }
          }
        `;
        const variables = { page: 1, perPage: limit, season, seasonYear };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const start = item?.startDate || {};
          const from = toIsoDate(start.year, start.month, start.day);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            aired: from ? { from } : { from: null }
          };
        });
        return {
          data: mapped.filter((item) => isoToYear(item?.aired?.from) >= 2025),
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = response?.status || 502;
          throw err;
        }
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        return data;
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    }).catch(() => {});
    return;
  }

  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const nowDate = new Date();
        const seasonYear = nowDate.getFullYear();
        const season = seasonFromMonth(nowDate.getMonth() + 1);
        const aniQuery = `
          query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                startDate { year month day }
              }
            }
          }
        `;
        const variables = { page: 1, perPage: limit, season, seasonYear };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const start = item?.startDate || {};
          const from = toIsoDate(start.year, start.month, start.day);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            aired: from ? { from } : { from: null }
          };
        });
        return {
          data: mapped.filter((item) => isoToYear(item?.aired?.from) >= 2025),
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = response?.status || 502;
          throw err;
        }
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        return data;
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }
      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Seasonal feed unavailable" });
  }
});

app.get("/api/jikan/anime/seasonal", async (req, res) => {
  const year = Number(req.query?.year || 0);
  const season = normalizeSeason(req.query?.season);
  const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 20));
  const page = Math.max(1, Number(req.query?.page) || 1);
  const primary = CATALOG_PRIMARY === "jikan" ? "jikan" : "anilist";

  if (!year || year < 2025) {
    return res.status(400).json({ error: "year must be 2025 or later" });
  }
  if (!season) {
    return res.status(400).json({ error: "season must be winter|spring|summer|fall" });
  }

  const fields = "mal_id,title,images,aired";
  const jikanUrl = `https://api.jikan.moe/v4/seasons/${encodeURIComponent(
    year
  )}/${encodeURIComponent(season)}?filter=tv&limit=${encodeURIComponent(
    limit
  )}&page=${encodeURIComponent(page)}&fields=${encodeURIComponent(fields)}`;
  const cacheKey = `catalog-anime-seasonal|primary=${primary}|year=${year}|season=${season}|page=${page}|limit=${limit}`;

  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_SEASON_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                startDate { year month day }
              }
            }
          }
        `;
        const variables = {
          page,
          perPage: limit,
          season: season.toUpperCase(),
          seasonYear: year
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = aniResp?.status || 502;
          throw err;
        }

        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media
          .map((item) => {
            const title =
              item?.title?.userPreferred ||
              item?.title?.english ||
              item?.title?.romaji ||
              "Unknown title";
            const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
            const start = item?.startDate || {};
            const from = toIsoDate(start.year, start.month, start.day);
            return {
              mal_id: item?.idMal || null,
              title,
              images: image
                ? { jpg: { image_url: image }, webp: { image_url: image } }
                : { jpg: { image_url: "" }, webp: { image_url: "" } },
              aired: from ? { from } : { from: null }
            };
          })
          .filter((item) => isoToYear(item?.aired?.from) >= 2025);
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || page,
            last_visible_page: pageInfo.lastPage || page,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = response?.status || 502;
          throw err;
        }
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        return data;
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    }).catch(() => {});
    return;
  }

  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                startDate { year month day }
              }
            }
          }
        `;
        const variables = {
          page,
          perPage: limit,
          season: season.toUpperCase(),
          seasonYear: year
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = aniResp?.status || 502;
          throw err;
        }

        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media
          .map((item) => {
            const title =
              item?.title?.userPreferred ||
              item?.title?.english ||
              item?.title?.romaji ||
              "Unknown title";
            const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
            const start = item?.startDate || {};
            const from = toIsoDate(start.year, start.month, start.day);
            return {
              mal_id: item?.idMal || null,
              title,
              images: image
                ? { jpg: { image_url: image }, webp: { image_url: image } }
                : { jpg: { image_url: "" }, webp: { image_url: "" } },
              aired: from ? { from } : { from: null }
            };
          })
          .filter((item) => isoToYear(item?.aired?.from) >= 2025);
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || page,
            last_visible_page: pageInfo.lastPage || page,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Seasonal feed unavailable");
          err.status = response?.status || 502;
          throw err;
        }
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        return data;
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Seasonal feed unavailable" });
  }
});

app.get("/api/jikan/manga/seasonal", async (req, res) => {
  const year = Number(req.query?.year || 0);
  const season = normalizeSeason(req.query?.season);
  const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 20));
  const page = Math.max(1, Number(req.query?.page) || 1);
  const SAFE_MAX_MANGA_SEASON_PAGES = 60;
  const PROBE_PER_PAGE = 20;

  if (year && year < 2025) {
    return res.status(400).json({ error: "year must be 2025 or later" });
  }

  const range = year && season ? startEndForSeason(year, season) : null;
  const url = range
    ? `anilist-manga-seasonal|${year}|${season}|${page}|${limit}`
    : `https://api.jikan.moe/v4/manga?status=publishing&order_by=start_date&sort=desc&page=${encodeURIComponent(
        page
      )}&limit=${encodeURIComponent(limit)}&fields=${encodeURIComponent("mal_id,title,images,published,status")}`;

  const cached = jikanCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_SEASON_TTL) {
    const cachedData = cached.data;
    const poisoned =
      Boolean(range) &&
      cachedData?.fromAniList === true &&
      Array.isArray(cachedData?.data) &&
      cachedData.data.length === 0 &&
      page === 1;
    if (!poisoned) {
      return res.json(cached.data);
    }
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    const cachedData = cached?.data;
    const poisoned =
      Boolean(range) &&
      cachedData?.fromAniList === true &&
      Array.isArray(cachedData?.data) &&
      cachedData.data.length === 0 &&
      page === 1;
    if (!poisoned) {
      res.set("X-Cache", "STALE");
      res.json(cached.data);
      return;
    }
  }

  let lastStatus = 0;
  if (!range) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        lastStatus = response.status;
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data?.data)) {
            const filtered = data.data.filter((item) => isoToYear(item?.published?.from) >= 2025);
            data.data = dedupeByKey(filtered, (item) => {
              const id = item?.mal_id;
              const from = item?.published?.from || "";
              return id ? `${id}|${from}` : "";
            });
          }
          cacheSetBounded(jikanCache, url, { data, ts: Date.now() }, MAX_JIKAN_CACHE);
          clearTimeout(timeout);
          if (!res.headersSent) {
            return res.json(data);
          }
          return;
        }
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable) {
          clearTimeout(timeout);
          break;
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("Jikan manga seasonal proxy error:", err?.message || err);
        }
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }

  if (cached && !res.headersSent) {
    return res.json(cached.data);
  }

  if (range) {
    // Use AniList for seasonal manga by startDate range. Jikan doesn't support manga seasons directly,
    // and scanning its pages for older seasons becomes rate-limit heavy.
    try {
      const toInt = (iso) => Number(String(iso).replace(/-/g, ""));
      const startInt = toInt(range.start) - 1;
      const endInt = toInt(range.end) + 1;
      const shouldProbeLastPage = page === 1 && limit === PROBE_PER_PAGE;
      const lastPageKey = `anilist-manga-seasonal-last|${year}|${season}|${PROBE_PER_PAGE}`;
      let effectiveLastPage = getCachedMangaSeasonLastPage(lastPageKey);
      if (!effectiveLastPage && shouldProbeLastPage) {
        try {
          effectiveLastPage = await computeAniListMangaSeasonLastPage({
            start: startInt,
            end: endInt,
            perPage: PROBE_PER_PAGE
          });
          if (effectiveLastPage) {
            setCachedMangaSeasonLastPage(lastPageKey, effectiveLastPage);
          }
        } catch (err) {
          // ignore probe failures
        }
      }
      const aniQuery = `
        query ($page: Int, $perPage: Int, $start: FuzzyDateInt, $end: FuzzyDateInt) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { currentPage lastPage hasNextPage }
            media(type: MANGA, startDate_greater: $start, startDate_lesser: $end, sort: POPULARITY_DESC) {
              idMal
              title { userPreferred english romaji }
              coverImage { extraLarge large }
              startDate { year month day }
              genres
              format
              chapters
              volumes
              description(asHtml: false)
              averageScore
              status
            }
          }
        }
      `;
      const variables = { page, perPage: limit, start: startInt, end: endInt };
      const response = await fetchAniListWithRetry("https://graphql.anilist.co", {
        timeoutMs: 12000,
        retries: 3,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: aniQuery, variables })
        }
      });
      if (!response.ok) {
        throw new Error(`AniList request failed (${response.status})`);
      }
      const json = await response.json();
      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        throw new Error(String(json.errors?.[0]?.message || "AniList error"));
      }
      const media = json?.data?.Page?.media || [];
      const pageInfo = json?.data?.Page?.pageInfo || {};

      const mapped = media
        .map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const start = item?.startDate || {};
          const from = toIsoDate(start.year, start.month, start.day);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            genres: Array.isArray(item?.genres) ? item.genres.map((name) => ({ name })) : [],
            type: item?.format || null,
            synopsis: item?.description || "",
            chapters: item?.chapters ?? null,
            volumes: item?.volumes ?? null,
            status: item?.status || null,
            score: item?.averageScore ? Number(item.averageScore) / 10 : null,
            published: from ? { from } : { from: null }
          };
        })
        .filter((item) => isoToYear(item?.published?.from) >= 2025);

      const deduped = dedupeByKey(mapped, (item) => {
        const id = item?.mal_id;
        const from = item?.published?.from || "";
        return id ? `${id}|${from}` : `${item?.title || "unknown"}|${from}`;
      });

      const payload = {
        data: deduped,
        pagination: {
          current_page: pageInfo.currentPage || page,
          last_visible_page: effectiveLastPage ||
            Math.min(pageInfo.lastPage || page, SAFE_MAX_MANGA_SEASON_PAGES),
          has_next_page: effectiveLastPage
            ? (pageInfo.currentPage || page) < effectiveLastPage
            : (pageInfo.currentPage || page) <
              Math.min(pageInfo.lastPage || page, SAFE_MAX_MANGA_SEASON_PAGES)
        },
        fromAniList: true
      };
      cacheSetBounded(jikanCache, url, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      if (!res.headersSent) {
        return res.json(payload);
      }
      return;
    } catch (err) {
      console.error("AniList manga seasonal failed:", err?.message || err);
      if (cached && !res.headersSent) {
        const cachedData = cached?.data;
        const poisoned =
          cachedData?.fromAniList === true &&
          Array.isArray(cachedData?.data) &&
          cachedData.data.length === 0 &&
          page === 1;
        if (!poisoned) {
          return res.json(cached.data);
        }
      }
      if (!res.headersSent) {
        return res.status(502).json({ error: "Manga seasonal feed unavailable" });
      }
      return;
    }
  }

  if (!res.headersSent) {
    return res.status(lastStatus || 502).json({ error: "Manga seasonal feed unavailable" });
  }
  return;
});

app.get("/api/jikan/top", async (req, res) => {
  const { type = "anime", page = "1" } = req.query || {};
  const endpoint = type === "manga" ? "manga" : "anime";
  const pageNum = Math.max(1, Number(page) || 1);
  const primary = CATALOG_PRIMARY === "jikan" ? "jikan" : "anilist";
  const jikanUrl = `https://api.jikan.moe/v4/top/${endpoint}?page=${encodeURIComponent(pageNum)}`;
  const cacheKey = `catalog-top|primary=${primary}|type=${endpoint}|page=${pageNum}`;
  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_TOP_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_TOP_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $type: MediaType) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: $type, sort: TRENDING_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                genres
                format
                episodes
                chapters
                description(asHtml: false)
                averageScore
                duration
                source
                status
                trailer { site id }
              }
            }
          }
        `;
        const variables = {
          page: pageNum,
          perPage: 20,
          type: endpoint === "manga" ? "MANGA" : "ANIME"
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList top failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const embedUrl = buildTrailerEmbedUrl(item?.trailer);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            genres: Array.isArray(item?.genres) ? item.genres.map((name) => ({ name })) : [],
            type: item?.format || null,
            episodes: endpoint === "anime" ? item?.episodes ?? null : undefined,
            chapters: endpoint === "manga" ? item?.chapters ?? null : undefined,
            synopsis: cleanText(item?.description || ""),
            score: item?.averageScore ? Number(item.averageScore) / 10 : null,
            duration: item?.duration ? `${item.duration} min per ep.` : null,
            source: item?.source || null,
            status: item?.status || null,
            trailer: embedUrl ? { embed_url: embedUrl } : null
          };
        });
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || pageNum,
            last_visible_page: pageInfo.lastPage || pageNum,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan top failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }
      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    }).catch(() => {});
    return;
  }
  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const attemptAniList = async () => {
        const aniQuery = `
          query ($page: Int, $perPage: Int, $type: MediaType) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { currentPage lastPage hasNextPage }
              media(type: $type, sort: TRENDING_DESC) {
                idMal
                title { userPreferred english romaji }
                coverImage { extraLarge large }
                genres
                format
                episodes
                chapters
                description(asHtml: false)
                averageScore
                duration
                source
                status
                trailer { site id }
              }
            }
          }
        `;
        const variables = {
          page: pageNum,
          perPage: 20,
          type: endpoint === "manga" ? "MANGA" : "ANIME"
        };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList top failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Page?.media || [];
        const pageInfo = json?.data?.Page?.pageInfo || {};
        const mapped = media.map((item) => {
          const title =
            item?.title?.userPreferred ||
            item?.title?.english ||
            item?.title?.romaji ||
            "Unknown title";
          const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
          const embedUrl = buildTrailerEmbedUrl(item?.trailer);
          return {
            mal_id: item?.idMal || null,
            title,
            images: image
              ? { jpg: { image_url: image }, webp: { image_url: image } }
              : { jpg: { image_url: "" }, webp: { image_url: "" } },
            genres: Array.isArray(item?.genres) ? item.genres.map((name) => ({ name })) : [],
            type: item?.format || null,
            episodes: endpoint === "anime" ? item?.episodes ?? null : undefined,
            chapters: endpoint === "manga" ? item?.chapters ?? null : undefined,
            synopsis: cleanText(item?.description || ""),
            score: item?.averageScore ? Number(item.averageScore) / 10 : null,
            duration: item?.duration ? `${item.duration} min per ep.` : null,
            source: item?.source || null,
            status: item?.status || null,
            trailer: embedUrl ? { embed_url: embedUrl } : null
          };
        });
        return {
          data: mapped,
          pagination: {
            current_page: pageInfo.currentPage || pageNum,
            last_visible_page: pageInfo.lastPage || pageNum,
            has_next_page: Boolean(pageInfo.hasNextPage)
          },
          fromAniList: true
        };
      };

      const attemptJikan = async () => {
        const response = await fetchJikanWithRetry(jikanUrl, { timeoutMs: 10000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan top failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Jikan top failed" });
  }
});

// Detail proxy endpoints.
// These keep the UI stable (it expects Jikan's "full" schema) while letting us:
// - apply caching
// - use our retry/throttle logic
// - optionally fall back to AniList when Jikan is down/rate-limited
app.get("/api/jikan/full", async (req, res) => {
  const endpoint = String(req.query?.type || "anime") === "manga" ? "manga" : "anime";
  const id = String(req.query?.id || "").trim();
  const malId = Number(id);
  if (!Number.isInteger(malId) || malId <= 0) {
    return res.status(400).json({ error: "Missing id" });
  }
  const cacheKey = `jikan-full|${endpoint}|${malId}`;
  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_DETAIL_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_DETAIL_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
    withInflight(jikanInflight, cacheKey, async () => {
      const primary = DETAIL_PRIMARY === "jikan" ? "jikan" : "anilist";

      const attemptJikan = async () => {
        const url = `https://api.jikan.moe/v4/${endpoint}/${encodeURIComponent(malId)}/full`;
        const response = await fetchJikanWithRetry(url, { timeoutMs: 12000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan detail failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      const attemptAniList = async () => {
        const aniQuery = `
          query ($idMal: Int, $type: MediaType) {
            Media(idMal: $idMal, type: $type) {
              idMal
              title { userPreferred english romaji }
              coverImage { extraLarge large }
              description(asHtml: false)
              format
              status
              season
              seasonYear
              startDate { year month day }
              endDate { year month day }
              episodes
              duration
              chapters
              volumes
              averageScore
              genres
              source
              trailer { site id }
              studios(isMain: true) { nodes { name } }
              popularity
            }
          }
        `;
        const variables = { idMal: malId, type: endpoint === "manga" ? "MANGA" : "ANIME" };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList detail failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Media;
        if (!media?.idMal) {
          const err = new Error("Not found");
          err.status = 404;
          throw err;
        }
        const trailerEmbed = buildTrailerEmbedUrl(media?.trailer);
        return {
          data: {
            mal_id: media.idMal,
            title: media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || "Unknown title",
            title_english: media?.title?.english || "",
            images: {
              jpg: { image_url: media?.coverImage?.extraLarge || media?.coverImage?.large || "" },
              webp: { image_url: media?.coverImage?.extraLarge || media?.coverImage?.large || "" }
            },
            synopsis: cleanText(media?.description || ""),
            type: media?.format || null,
            status: media?.status || null,
            season: String(media?.season || "").toLowerCase() || "",
            year: media?.seasonYear || null,
            aired:
              endpoint === "anime"
                ? { string: "", from: toIsoDate(media?.startDate?.year, media?.startDate?.month, media?.startDate?.day) || null }
                : undefined,
            published:
              endpoint === "manga"
                ? { string: "", from: toIsoDate(media?.startDate?.year, media?.startDate?.month, media?.startDate?.day) || null }
                : undefined,
            episodes: endpoint === "anime" ? media?.episodes ?? null : undefined,
            duration: endpoint === "anime" && media?.duration ? `${media.duration} min per ep.` : null,
            chapters: endpoint === "manga" ? media?.chapters ?? null : undefined,
            volumes: endpoint === "manga" ? media?.volumes ?? null : undefined,
            score: media?.averageScore ? Number(media.averageScore) / 10 : null,
            genres: Array.isArray(media?.genres) ? media.genres.map((name) => ({ name })) : [],
            source: media?.source || null,
            studios: Array.isArray(media?.studios?.nodes) ? media.studios.nodes.map((s) => ({ name: s.name })) : [],
            trailer: trailerEmbed ? { embed_url: trailerEmbed } : null,
            popularity: media?.popularity ?? null,
            producers: [],
            licensors: [],
            demographics: [],
            streaming: [],
            rating: ""
          },
          fromAniList: true
        };
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }
      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
    }).catch(() => {});
    return;
  }
  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const primary = DETAIL_PRIMARY === "jikan" ? "jikan" : "anilist";

      const attemptJikan = async () => {
        const url = `https://api.jikan.moe/v4/${endpoint}/${encodeURIComponent(malId)}/full`;
        const response = await fetchJikanWithRetry(url, { timeoutMs: 12000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan detail failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      const attemptAniList = async () => {
        const aniQuery = `
          query ($idMal: Int, $type: MediaType) {
            Media(idMal: $idMal, type: $type) {
              idMal
              title { userPreferred english romaji }
              coverImage { extraLarge large }
              description(asHtml: false)
              format
              status
              season
              seasonYear
              startDate { year month day }
              endDate { year month day }
              episodes
              duration
              chapters
              volumes
              averageScore
              genres
              source
              trailer { site id }
              studios(isMain: true) { nodes { name } }
              popularity
            }
          }
        `;
        const variables = { idMal: malId, type: endpoint === "manga" ? "MANGA" : "ANIME" };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList detail failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const media = json?.data?.Media;
        if (!media?.idMal) {
          const err = new Error("Not found");
          err.status = 404;
          throw err;
        }
        const trailerEmbed = buildTrailerEmbedUrl(media?.trailer);
        return {
          data: {
            mal_id: media.idMal,
            title: media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || "Unknown title",
            title_english: media?.title?.english || "",
            images: {
              jpg: { image_url: media?.coverImage?.extraLarge || media?.coverImage?.large || "" },
              webp: { image_url: media?.coverImage?.extraLarge || media?.coverImage?.large || "" }
            },
            synopsis: cleanText(media?.description || ""),
            type: media?.format || null,
            status: media?.status || null,
            season: String(media?.season || "").toLowerCase() || "",
            year: media?.seasonYear || null,
            aired:
              endpoint === "anime"
                ? { string: "", from: toIsoDate(media?.startDate?.year, media?.startDate?.month, media?.startDate?.day) || null }
                : undefined,
            published:
              endpoint === "manga"
                ? { string: "", from: toIsoDate(media?.startDate?.year, media?.startDate?.month, media?.startDate?.day) || null }
                : undefined,
            episodes: endpoint === "anime" ? media?.episodes ?? null : undefined,
            duration: endpoint === "anime" && media?.duration ? `${media.duration} min per ep.` : null,
            chapters: endpoint === "manga" ? media?.chapters ?? null : undefined,
            volumes: endpoint === "manga" ? media?.volumes ?? null : undefined,
            score: media?.averageScore ? Number(media.averageScore) / 10 : null,
            genres: Array.isArray(media?.genres) ? media.genres.map((name) => ({ name })) : [],
            source: media?.source || null,
            studios: Array.isArray(media?.studios?.nodes) ? media.studios.nodes.map((s) => ({ name: s.name })) : [],
            trailer: trailerEmbed ? { embed_url: trailerEmbed } : null,
            popularity: media?.popularity ?? null,
            producers: [],
            licensors: [],
            demographics: [],
            streaming: [],
            rating: ""
          },
          fromAniList: true
        };
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Detail fetch failed" });
  }
});

app.get("/api/jikan/characters", async (req, res) => {
  const id = String(req.query?.id || "").trim();
  const malId = Number(id);
  if (!Number.isInteger(malId) || malId <= 0) {
    return res.status(400).json({ error: "Missing id" });
  }
  const cacheKey = `jikan-characters|anime|${malId}`;
  const cached = jikanCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_DETAIL_TTL) {
    return res.json(cached.data);
  }
  try {
    const result = await withInflight(jikanInflight, cacheKey, async () => {
      const primary = DETAIL_PRIMARY === "jikan" ? "jikan" : "anilist";

      const attemptJikan = async () => {
        const url = `https://api.jikan.moe/v4/anime/${encodeURIComponent(malId)}/characters`;
        const response = await fetchJikanWithRetry(url, { timeoutMs: 12000, retries: 3 });
        if (!response || !response.ok) {
          const err = new Error("Jikan characters failed");
          err.status = response?.status || 502;
          throw err;
        }
        return await response.json();
      };

      const attemptAniList = async () => {
        const aniQuery = `
          query ($idMal: Int) {
            Media(idMal: $idMal, type: ANIME) {
              characters(perPage: 10, sort: [FAVOURITES_DESC]) {
                edges {
                  role
                  node {
                    id
                    name { full }
                    image { large }
                  }
                }
              }
            }
          }
        `;
        const variables = { idMal: malId };
        const aniResp = await fetchAniListWithRetry("https://graphql.anilist.co", {
          timeoutMs: 12000,
          retries: 3,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query: aniQuery, variables })
          }
        });
        if (!aniResp || !aniResp.ok) {
          const err = new Error("AniList characters failed");
          err.status = aniResp?.status || 502;
          throw err;
        }
        const json = await aniResp.json().catch(() => ({}));
        const edges = json?.data?.Media?.characters?.edges || [];
        const mapped = edges
          .map((e) => ({
            role: e?.role || "Supporting",
            character: {
              mal_id: e?.node?.id || null,
              name: e?.node?.name?.full || "",
              images: {
                jpg: { image_url: e?.node?.image?.large || "" }
              }
            }
          }))
          .filter((x) => x.character?.name);
        return { data: mapped, fromAniList: true };
      };

      let payload;
      if (primary === "anilist") {
        try {
          payload = await attemptAniList();
        } catch (err) {
          if (!JIKAN_FALLBACK_ENABLED) throw err;
          payload = await attemptJikan();
        }
      } else {
        try {
          payload = await attemptJikan();
        } catch (err) {
          payload = await attemptAniList();
        }
      }

      cacheSetBounded(jikanCache, cacheKey, { data: payload, ts: Date.now() }, MAX_JIKAN_CACHE);
      return { status: 200, data: payload };
    });
    return res.status(result.status).json(result.data);
  } catch (err) {
    if (cached) {
      res.set("X-Cache", "STALE");
      return res.json(cached.data);
    }
    return res.status(err?.status || 502).json({ error: "Characters unavailable" });
  }
});

app.listen(port, () => {
  console.log(`News summary server running on http://localhost:${port}`);
});
