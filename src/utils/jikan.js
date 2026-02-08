const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchJikanSuggestions = async ({ type, query, signal }) => {
  const q = (query || "").trim();
  if (!q) return [];

  const endpointType = type === "manga" ? "manga" : "anime";
  const fields = ["mal_id", "title", "images"].join(",");
  const url = `/api/jikan?type=${endpointType}&q=${encodeURIComponent(q)}&page=1&limit=8&fields=${encodeURIComponent(fields)}`;

  let response = await fetch(url, { signal });
  if (response.status === 429) {
    await sleep(350);
    response = await fetch(url, { signal });
  }
  if (!response.ok) {
    return [];
  }
  const json = await response.json();
  const data = Array.isArray(json?.data) ? json.data : [];

  return data
    .map((item) => {
      const title = item?.title || item?.title_english || item?.title_japanese || "";
      const image =
        item?.images?.jpg?.image_url ||
        item?.images?.webp?.image_url ||
        "";
      return {
        mal_id: item?.mal_id,
        title,
        image
      };
    })
    .filter((item) => item.mal_id && item.title);
};

