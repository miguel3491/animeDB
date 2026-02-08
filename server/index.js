require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { XMLParser } = require("fast-xml-parser");
const cheerio = require("cheerio");

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!apiKey) {
  console.warn("Missing OPENAI_API_KEY. /api/summary will return 503.");
}

const client = apiKey ? new OpenAI({ apiKey }) : null;
const summaryCache = new Map();
const jikanCache = new Map();
const JIKAN_TTL = 2 * 60 * 1000;
const JIKAN_TOP_TTL = 5 * 60 * 1000;
const JIKAN_SEASON_TTL = 10 * 60 * 1000;
const STALE_MAX = 15 * 60 * 1000;
const ANN_FEED_URL = "https://www.animenewsnetwork.com/news/rss.xml";
const annCache = new Map();
const ANN_TTL = 5 * 60 * 1000;
const mangaSeasonLastPageCache = new Map();
const MANGA_SEASON_LASTPAGE_TTL = 60 * 60 * 1000;

const shouldServeStale = (cached, ttl) => {
  if (!cached) return false;
  const age = Date.now() - cached.ts;
  return age > ttl && age < STALE_MAX;
};

const buildCacheKey = (title, content) => {
  const base = `${title || ""}\n${content || ""}`.trim();
  return base.slice(0, 2000);
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

const fetchWithTimeout = async (url, { timeoutMs = 10000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
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

const fetchAniListMangaSeasonPageLen = async ({ page, perPage, start, end }) => {
  const query = `
    query ($page: Int, $perPage: Int, $start: FuzzyDateInt, $end: FuzzyDateInt) {
      Page(page: $page, perPage: $perPage) {
        media(type: MANGA, startDate_greater: $start, startDate_lesser: $end, sort: POPULARITY_DESC) { id }
      }
    }
  `;
  const variables = { page, perPage, start, end };
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json().catch(() => ({}));
  const media = json?.data?.Page?.media;
  return Array.isArray(media) ? media.length : 0;
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
    if (len < perPage) {
      return low;
    }
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
      if (len < perPage) {
        return low;
      }
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
            "You are a news summarizer. Return JSON with keys summary and keyPoints. " +
            "summary must be 2-3 original sentences in English that do not copy or closely paraphrase the source. " +
            "keyPoints must be an array of 3-5 short bullets."
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
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : []
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

app.post("/api/anilist", async (req, res) => {
  try {
    const { query, variables } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("AniList proxy error:", err?.message || err);
    return res.status(500).json({ error: "AniList proxy failed" });
  }
});

app.get("/api/ann/news", async (req, res) => {
  const limit = Math.max(1, Math.min(60, Number(req.query?.limit) || 30));
  const cacheKey = `ann-feed|${limit}`;
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
    const items = (Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw])
      .filter(Boolean)
      .slice(0, limit)
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
          categories,
          description,
          summary: description,
          sourceId: "ann",
          sourceName: "Anime News Network"
        };
      });

    const payload = { items };
    annCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.json(payload);
  } catch (err) {
    console.error("ANN feed error:", err?.message || err);
    return res.status(502).json({ error: "ANN feed unavailable" });
  }
});

app.get("/api/ann/article", async (req, res) => {
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
            $img.attr("data-url") ||
            ""
        ).trim();
      const dataSrcset = String($img.attr("data-srcset") || "").trim();
      const srcset = String($img.attr("srcset") || "").trim();

      let chosen = srcAttr;
      if (!chosen || chosen.startsWith("data:")) {
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
      // Some third-party hosts block embeds. We don't proxy images here (copyright/ToS risk),
      // but we do improve the chance of loading and provide metadata for the UI.
      $img.attr("loading", "lazy");
      $img.attr("decoding", "async");
      $img.attr("referrerpolicy", "no-referrer");

      if (normalized) {
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
  if (!q) {
    return res.status(400).json({ error: "Missing search query" });
  }
  const endpoint = type === "manga" ? "manga" : "anime";
  const base = `https://api.jikan.moe/v4/${endpoint}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}`;
  const withFields = fields ? `${base}&fields=${encodeURIComponent(fields)}` : base;
  const url = limit ? `${withFields}&limit=${encodeURIComponent(limit)}` : withFields;
  const cached = jikanCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
  }
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        jikanCache.set(url, { data, ts: Date.now() });
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
        console.error("Jikan proxy error:", err?.message || err);
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  if (cached && !res.headersSent) {
    return res.json(cached.data);
  }

  // Fallback to AniList search when Jikan is unavailable.
  try {
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
      page: Number(page) || 1,
      perPage: Number(limit) || 20,
      search: String(q),
      type: endpoint === "manga" ? "MANGA" : "ANIME"
    };
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query: aniQuery, variables })
    });
    const json = await response.json();
    const media = json?.data?.Page?.media || [];
    const pageInfo = json?.data?.Page?.pageInfo || {};
    const mapped = media.map((item) => {
      const title =
        item?.title?.userPreferred ||
        item?.title?.english ||
        item?.title?.romaji ||
        "Unknown title";
      const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
      const trailerId = item?.trailer?.id;
      const trailerSite = (item?.trailer?.site || "").toLowerCase();
      const embedUrl =
        trailerSite === "youtube" && trailerId
          ? `https://www.youtube.com/embed/${trailerId}`
          : trailerSite === "dailymotion" && trailerId
          ? `https://www.dailymotion.com/embed/video/${trailerId}`
          : "";
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
        synopsis: item?.description || "",
        score: item?.averageScore ? Number(item.averageScore) / 10 : null,
        duration: item?.duration ? `${item.duration} min per ep.` : null,
        source: item?.source || null,
        status: item?.status || null,
        trailer: embedUrl ? { embed_url: embedUrl } : null
      };
    });
    const payload = {
      data: mapped,
      pagination: {
        current_page: pageInfo.currentPage || Number(page) || 1,
        last_visible_page: pageInfo.lastPage || Number(page) || 1,
        has_next_page: Boolean(pageInfo.hasNextPage)
      },
      fromAniList: true
    };
    jikanCache.set(url, { data: payload, ts: Date.now() });
    if (!res.headersSent) {
      return res.json(payload);
    }
    return;
  } catch (err) {
    console.error("AniList fallback failed:", err?.message || err);
  }

  if (!res.headersSent) {
    return res.status(lastStatus || 502).json({ error: "Jikan search failed" });
  }
  return;
});

app.get("/api/jikan/season", async (req, res) => {
  const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 10));
  const page = Math.max(1, Number(req.query?.page) || 1);
  const fields = "mal_id,title,images,aired";
  const url = `https://api.jikan.moe/v4/seasons/now?filter=tv&limit=${encodeURIComponent(
    limit
  )}&page=${encodeURIComponent(page)}&fields=${encodeURIComponent(fields)}`;

  const cached = jikanCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_SEASON_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        jikanCache.set(url, { data, ts: Date.now() });
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
        console.error("Jikan season proxy error:", err?.message || err);
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  if (cached && !res.headersSent) {
    return res.json(cached.data);
  }

  // Fallback to AniList seasonal when Jikan is unavailable.
  try {
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
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query: aniQuery, variables })
    });
    const json = await response.json();
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
    const payload = {
      data: mapped.filter((item) => isoToYear(item?.aired?.from) >= 2025),
      fromAniList: true
    };
    jikanCache.set(url, { data: payload, ts: Date.now() });
    if (!res.headersSent) {
      return res.json(payload);
    }
    return;
  } catch (err) {
    console.error("AniList seasonal fallback failed:", err?.message || err);
  }

  if (!res.headersSent) {
    return res.status(lastStatus || 502).json({ error: "Seasonal feed unavailable" });
  }
  return;
});

app.get("/api/jikan/anime/seasonal", async (req, res) => {
  const year = Number(req.query?.year || 0);
  const season = normalizeSeason(req.query?.season);
  const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 20));
  const page = Math.max(1, Number(req.query?.page) || 1);

  if (!year || year < 2025) {
    return res.status(400).json({ error: "year must be 2025 or later" });
  }
  if (!season) {
    return res.status(400).json({ error: "season must be winter|spring|summer|fall" });
  }

  const fields = "mal_id,title,images,aired";
  const url = `https://api.jikan.moe/v4/seasons/${encodeURIComponent(
    year
  )}/${encodeURIComponent(season)}?filter=tv&limit=${encodeURIComponent(
    limit
  )}&page=${encodeURIComponent(page)}&fields=${encodeURIComponent(fields)}`;

  const cached = jikanCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_SEASON_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          data.data = data.data.filter((item) => isoToYear(item?.aired?.from) >= 2025);
        }
        jikanCache.set(url, { data, ts: Date.now() });
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
        console.error("Jikan seasonal proxy error:", err?.message || err);
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  if (cached && !res.headersSent) {
    return res.json(cached.data);
  }

  // Fallback to AniList seasonal when Jikan is unavailable.
  try {
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
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: aniQuery, variables })
    });
    const json = await response.json();
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
    const payload = {
      data: mapped,
      pagination: {
        current_page: pageInfo.currentPage || page,
        last_visible_page: pageInfo.lastPage || page,
        has_next_page: Boolean(pageInfo.hasNextPage)
      },
      fromAniList: true
    };
    jikanCache.set(url, { data: payload, ts: Date.now() });
    if (!res.headersSent) {
      return res.json(payload);
    }
    return;
  } catch (err) {
    console.error("AniList seasonal fallback failed:", err?.message || err);
  }

  if (!res.headersSent) {
    return res.status(lastStatus || 502).json({ error: "Seasonal feed unavailable" });
  }
  return;
});

app.get("/api/jikan/manga/seasonal", async (req, res) => {
  const year = Number(req.query?.year || 0);
  const season = normalizeSeason(req.query?.season);
  const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 20));
  const page = Math.max(1, Number(req.query?.page) || 1);

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
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_SEASON_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
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
          jikanCache.set(url, { data, ts: Date.now() });
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
      const lastPageKey = `anilist-manga-seasonal-last|${year}|${season}|${limit}`;
      let effectiveLastPage = getCachedMangaSeasonLastPage(lastPageKey);
      if (!effectiveLastPage && page === 1) {
        try {
          effectiveLastPage = await computeAniListMangaSeasonLastPage({
            start: startInt,
            end: endInt,
            perPage: limit
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
      const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: aniQuery, variables })
      });
      const json = await response.json();
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
          last_visible_page: effectiveLastPage || pageInfo.lastPage || page,
          has_next_page: effectiveLastPage
            ? (pageInfo.currentPage || page) < effectiveLastPage
            : Boolean(pageInfo.hasNextPage)
        },
        fromAniList: true
      };
      jikanCache.set(url, { data: payload, ts: Date.now() });
      if (!res.headersSent) {
        return res.json(payload);
      }
      return;
    } catch (err) {
      console.error("AniList manga seasonal failed:", err?.message || err);
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
  const url = `https://api.jikan.moe/v4/top/${endpoint}?page=${encodeURIComponent(page)}`;
  const cached = jikanCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < JIKAN_TOP_TTL) {
    return res.json(cached.data);
  }
  if (shouldServeStale(cached, JIKAN_TOP_TTL)) {
    res.set("X-Cache", "STALE");
    res.json(cached.data);
  }
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) {
        const data = await response.json();
        jikanCache.set(url, { data, ts: Date.now() });
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
        console.error("Jikan top proxy error:", err?.message || err);
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  // Fallback to AniList top when Jikan is unavailable.
  try {
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
      page: Number(page) || 1,
      perPage: 20,
      type: endpoint === "manga" ? "MANGA" : "ANIME"
    };
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query: aniQuery, variables })
    });
    const json = await response.json();
    const media = json?.data?.Page?.media || [];
    const pageInfo = json?.data?.Page?.pageInfo || {};
    const mapped = media.map((item) => {
      const title =
        item?.title?.userPreferred ||
        item?.title?.english ||
        item?.title?.romaji ||
        "Unknown title";
      const image = item?.coverImage?.extraLarge || item?.coverImage?.large || "";
      const trailerId = item?.trailer?.id;
      const trailerSite = (item?.trailer?.site || "").toLowerCase();
      const embedUrl =
        trailerSite === "youtube" && trailerId
          ? `https://www.youtube.com/embed/${trailerId}`
          : trailerSite === "dailymotion" && trailerId
          ? `https://www.dailymotion.com/embed/video/${trailerId}`
          : "";
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
        synopsis: item?.description || "",
        score: item?.averageScore ? Number(item.averageScore) / 10 : null,
        duration: item?.duration ? `${item.duration} min per ep.` : null,
        source: item?.source || null,
        status: item?.status || null,
        trailer: embedUrl ? { embed_url: embedUrl } : null
      };
    });
    const payload = {
      data: mapped,
      pagination: {
        current_page: pageInfo.currentPage || Number(page) || 1,
        last_visible_page: pageInfo.lastPage || Number(page) || 1,
        has_next_page: Boolean(pageInfo.hasNextPage)
      },
      fromAniList: true
    };
    jikanCache.set(url, { data: payload, ts: Date.now() });
    if (!res.headersSent) {
      return res.json(payload);
    }
    return;
  } catch (err) {
    console.error("AniList top fallback failed:", err?.message || err);
  }

  if (cached && !res.headersSent) {
    return res.json(cached.data);
  }
  if (!res.headersSent) {
    return res.status(lastStatus || 502).json({ error: "Jikan top failed" });
  }
  return;
});

app.listen(port, () => {
  console.log(`News summary server running on http://localhost:${port}`);
});
