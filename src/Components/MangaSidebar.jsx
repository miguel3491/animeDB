import React from "react";
import { Link } from "react-router-dom";
import { getAniListMangaCoverFromCache } from "../utils/anilist";

function MangaSidebar({ topManga, imageMap, fromPath }) {
  const safeTop = Array.isArray(topManga) ? topManga : [];
  const sortedTop = [...safeTop].filter(Boolean).slice(0, 10);
  const seasonLabelFromIso = (value) => {
    if (!value) return "TBA";
    const iso = String(value).slice(0, 10);
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "TBA";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const season =
      [12, 1, 2].includes(month) ? "Winter" :
      [3, 4, 5].includes(month) ? "Spring" :
      [6, 7, 8].includes(month) ? "Summer" :
      "Fall";
    return `${season} ${year}`;
  };

  return (
    <aside>
      <div className="sidebar-card">
        <h4>Seasonal Manga</h4>
        <div className="sidebar-scroll">
          {sortedTop.map((manga, index) => (
            <div
              className="sidebar-item"
              key={
                manga?.mal_id
                  ? `side-manga-${manga.mal_id}-${String(manga?.published?.from || "")}-${index}`
                  : `${manga.title}-${index}`
              }
            >
              <span className="side-rank">#{index + 1}</span>
              {(imageMap?.[manga.mal_id] || getAniListMangaCoverFromCache(manga.mal_id) || manga?.images?.jpg?.image_url || manga?.images?.webp?.image_url) ? (
                <img
                  className="side-image"
                  src={
                    imageMap?.[manga.mal_id] ||
                    getAniListMangaCoverFromCache(manga.mal_id) ||
                    manga?.images?.jpg?.image_url ||
                    manga?.images?.webp?.image_url
                  }
                  alt={manga.title}
                ></img>
              ) : (
                <div className="side-image placeholder" aria-label={`${manga.title} cover unavailable`}></div>
              )}
              <div className="side-text">
                {manga?.mal_id ? (
                  <Link className="anime-title" to={`/manga/${manga.mal_id}`} state={{ from: fromPath || "/manga" }}>
                    {manga.title}
                  </Link>
                ) : (
                  <span className="anime-title disabled" title="Details unavailable (missing MAL id).">
                    {manga.title}
                  </span>
                )}
                <div className="side-meta">Season: {seasonLabelFromIso(manga?.published?.from)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default MangaSidebar;
