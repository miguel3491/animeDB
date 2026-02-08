import React from "react";
import { Link } from "react-router-dom";
import { getAniListCoverFromCache } from "../utils/anilist";

function Sidebar({topAnime, imageMap}){
    const safeTop = Array.isArray(topAnime) ? topAnime : [];
    const sortedTop = [...safeTop].filter((anime) => anime && anime.mal_id).slice(0, 10);
    const formatRelease = (value) => {
      if (!value) return "TBA";
      const iso = String(value).slice(0, 10);
      return iso && iso !== "null" ? iso : "TBA";
    };
    return(
        <aside>
            <div className="sidebar-card">
                <h4>Seasonal Anime</h4>
                <div className="sidebar-scroll">
                {sortedTop.map((anime, index) => (
                    <div className="sidebar-item" key={anime.mal_id}>
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
                      <Link className="anime-title" to={`/anime/${anime.mal_id}`}>
                          {anime.title}
                      </Link>
                      <div className="side-meta">Release: {formatRelease(anime?.aired?.from)}</div>
                    </div>
                    </div>
                ))}  
                </div>    
            </div>
        </aside>
    )
}
export default Sidebar;
