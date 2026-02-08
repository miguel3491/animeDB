const DEFAULT_ENDPOINT = "/api/anilist";
const LOCAL_ENDPOINT = "http://localhost:4000/api/anilist";
const RESPONSE_CACHE_TTL = 5 * 60 * 1000;
const coverCache = new Map();
const mangaCoverCache = new Map();
const responseCache = new Map();
const inFlight = new Map();
let lastRequestAt = 0;
let requestChain = Promise.resolve();
const MIN_INTERVAL = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduleRequest = (fn) => {
  const task = requestChain.then(fn, fn);
  requestChain = task.catch(() => {});
  return task;
};

const makeCacheKey = (payload) => {
  const query = payload?.query || "";
  const variables = payload?.variables ? JSON.stringify(payload.variables) : "";
  return `${query}::${variables}`;
};

const getCached = (key) => {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > RESPONSE_CACHE_TTL) {
    responseCache.delete(key);
    return null;
  }
  return cached.data;
};

const setCached = (key, data) => {
  responseCache.set(key, { data, ts: Date.now() });
};

const postAniList = async (payload) => {
  const cacheKey = makeCacheKey(payload);
  const cached = getCached(cacheKey);
  if (cached) {
    return { ok: true, status: 200, json: async () => cached, cached: true };
  }
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const task = scheduleRequest(async () => {
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const endpoints = isLocalhost ? [DEFAULT_ENDPOINT, LOCAL_ENDPOINT] : [DEFAULT_ENDPOINT];
    let response;
    const now = Date.now();
    const wait = Math.max(0, MIN_INTERVAL - (now - lastRequestAt));
    if (wait > 0) {
      await sleep(wait);
    }
    lastRequestAt = Date.now();

    for (const endpoint of endpoints) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (response.status !== 404) {
        break;
      }
    }

    if (response.status === 429) {
      const stale = getCached(cacheKey);
      if (stale) {
        return { ok: true, status: 200, json: async () => stale, cached: true };
      }
      await sleep(800);
      response = await fetch(isLocalhost ? LOCAL_ENDPOINT : DEFAULT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
    }

    return response;
  });

  inFlight.set(cacheKey, task);
  task.finally(() => {
    inFlight.delete(cacheKey);
  });
  return task;
};

const chunk = (items, size) => {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

export const getAniListCoverFromCache = (idMal) => {
  if (!idMal) return "";
  return coverCache.get(Number(idMal)) || "";
};

export const getAniListMangaCoverFromCache = (idMal) => {
  if (!idMal) return "";
  return mangaCoverCache.get(Number(idMal)) || "";
};

export const fetchAniListCoversByMalIds = async (ids) => {
  const normalized = ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const unique = Array.from(new Set(normalized)).filter(
    (id) => !coverCache.has(id)
  );

  if (unique.length === 0) {
    return new Map();
  }

  const results = new Map();
  const groups = chunk(unique, 12);

  for (const group of groups) {
    const selections = group
      .map(
        (id, index) => `
          media${index}: Media(idMal: ${id}, type: ANIME) {
            idMal
            coverImage { extraLarge large }
          }
        `
      )
      .join("\n");

    const query = `query { ${selections} }`;
    try {
      const response = await postAniList({ query });
      if (!response.ok) {
        continue;
      }
      const json = await response.json();
      const data = json?.data || {};

      Object.values(data).forEach((media) => {
        const idMal = Number(media?.idMal);
        if (!Number.isInteger(idMal)) return;
        const cover =
          media?.coverImage?.extraLarge || media?.coverImage?.large || "";
        if (cover) {
          coverCache.set(idMal, cover);
          results.set(idMal, cover);
        }
      });
    } catch (error) {
      // ignore AniList fetch errors
    }
  }

  return results;
};

export const fetchAniListMangaCoversByMalIds = async (ids) => {
  const normalized = ids
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const unique = Array.from(new Set(normalized)).filter(
    (id) => !mangaCoverCache.has(id)
  );

  if (unique.length === 0) {
    return new Map();
  }

  const results = new Map();
  const groups = chunk(unique, 12);

  for (const group of groups) {
    const selections = group
      .map(
        (id, index) => `
          media${index}: Media(idMal: ${id}, type: MANGA) {
            idMal
            coverImage { extraLarge large }
          }
        `
      )
      .join("\n");

    const query = `query { ${selections} }`;
    try {
      const response = await postAniList({ query });
      if (!response.ok) {
        continue;
      }
      const json = await response.json();
      const data = json?.data || {};

      Object.values(data).forEach((media) => {
        const idMal = Number(media?.idMal);
        if (!Number.isInteger(idMal)) return;
        const cover =
          media?.coverImage?.extraLarge || media?.coverImage?.large || "";
        if (cover) {
          mangaCoverCache.set(idMal, cover);
          results.set(idMal, cover);
        }
      });
    } catch (error) {
      // ignore AniList fetch errors
    }
  }

  return results;
};

export const fetchAniList = async ({ query, variables }) => {
  const payload = { query, variables };
  const cacheKey = makeCacheKey(payload);
  const cached = getCached(cacheKey);

  const attempt = async () => {
    const response = await postAniList(payload);
    if (!response.ok) {
      const error = new Error(`AniList request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    setCached(cacheKey, data);
    return data;
  };

  try {
    return await attempt();
  } catch (err) {
    if (err?.status === 429) {
      if (cached) {
        return cached;
      }
      await sleep(2000);
      try {
        return await attempt();
      } catch (err2) {
        await sleep(5000);
        return attempt();
      }
    }
    throw err;
  }
};
