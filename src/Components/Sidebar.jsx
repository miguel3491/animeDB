import React from "react";
import { Link } from "react-router-dom";
import { getAniListCoverFromCache } from "../utils/anilist";

function Sidebar({topAnime, imageMap, fromPath}){
    const safeTop = Array.isArray(topAnime) ? topAnime : [];
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
    return(
        <aside>
            <div className="sidebar-card">
                <h4>Seasonal Anime</h4>
                <div className="sidebar-scroll">
                {sortedTop.map((anime, index) => (
                    <div className="sidebar-item" key={anime.mal_id ?? `${anime.title}-${index}`}>
                    <span className="side-rank">#{index + 1}</span>
                    {(imageMap?.[anime.mal_id] || getAniListCoverFromCache(anime.mal_id) || anime?.images?.jpg?.image_url || anime?.images?.webp?.image_url) ? (
                      <img
                        className="side-image"
                        src={imageMap?.[anime.mal_id] || getAniListCoverFromCache(anime.mal_id) || anime?.images?.jpg?.image_url || anime?.images?.webp?.image_url}
                        alt={anime.title}
                      ></img>
                    ) : (
                      <div className="side-image placeholder" aria-label={`${anime.title} cover unavailable`}></div>
                    )}
                    <div className="side-text">
                      {anime?.mal_id ? (
                        <Link className="anime-title" to={`/anime/${anime.mal_id}`} state={{ from: fromPath || "/" }}>
                            {anime.title}
                        </Link>
                      ) : (
                        <span className="anime-title disabled" title="Details unavailable (missing MAL id).">
                          {anime.title}
                        </span>
                      )}
                      <div className="side-meta">Season: {seasonLabelFromIso(anime?.aired?.from)}</div>
                    </div>
                    </div>
                ))}  
                </div>    
            </div>
        </aside>
    )
}
export default Sidebar;
