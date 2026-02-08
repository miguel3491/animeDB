import React from "react";
import { Link } from "react-router-dom";
import { getAniListMangaCoverFromCache } from "../utils/anilist";

function MangaSidebar({ topManga, imageMap, fromPath }) {
  const safeTop = Array.isArray(topManga) ? topManga : [];
  const sortedTop = [...safeTop]
    .filter((manga) => manga && manga.mal_id)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .slice(0, 10);

  return (
    <aside>
      <div className="sidebar-card">
        <h4>Top Manga Series</h4>
        <div className="sidebar-scroll">
          {sortedTop.map((manga, index) => (
            <div className="sidebar-item" key={manga.mal_id}>
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
              <Link className="anime-title" to={`/manga/${manga.mal_id}`} state={{ from: fromPath || "/manga" }}>
                {manga.title}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default MangaSidebar;
