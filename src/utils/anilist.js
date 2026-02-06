const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const coverCache = new Map();

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
      const response = await fetch(ANILIST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ query })
      });
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
