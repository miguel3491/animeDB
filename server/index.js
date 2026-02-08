require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

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
const STALE_MAX = 15 * 60 * 1000;

const shouldServeStale = (cached, ttl) => {
  if (!cached) return false;
  const age = Date.now() - cached.ts;
  return age > ttl && age < STALE_MAX;
};

const buildCacheKey = (title, content) => {
  const base = `${title || ""}\n${content || ""}`.trim();
  return base.slice(0, 2000);
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

app.get("/api/jikan", async (req, res) => {
  const { type = "anime", q = "", page = "1", fields = "" } = req.query || {};
  if (!q) {
    return res.status(400).json({ error: "Missing search query" });
  }
  const endpoint = type === "manga" ? "manga" : "anime";
  const base = `https://api.jikan.moe/v4/${endpoint}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}`;
  const url = fields ? `${base}&fields=${encodeURIComponent(fields)}` : base;
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
      perPage: 20,
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
