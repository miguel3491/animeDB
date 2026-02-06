import React from "react";
import { Link } from "react-router-dom";
import { getAniListCoverFromCache } from "../utils/anilist";

function Sidebar({topAnime, imageMap}){
    const safeTop = Array.isArray(topAnime) ? topAnime : [];
    const sortedTop = [...safeTop]
        .filter((anime) => anime && anime.mal_id)
        .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
        .slice(0, 10);
    return(
        <aside>
            <div className="sidebar-card">
                <h4>Top Anime Series</h4>
                <div className="sidebar-scroll">
                {sortedTop.map((anime, index) => (
                    <div className="sidebar-item" key={anime.mal_id}>
                    <span className="side-rank">#{index + 1}</span>
                    {(imageMap?.[anime.mal_id] || getAniListCoverFromCache(anime.mal_id)) ? (
                      <img
                        className="side-image"
                        src={imageMap?.[anime.mal_id] || getAniListCoverFromCache(anime.mal_id)}
                        alt={anime.title}
                      ></img>
                    ) : (
                      <div className="side-image placeholder" aria-label={`${anime.title} cover unavailable`}></div>
                    )}
                    <Link className="anime-title" to={`/anime/${anime.mal_id}`}>
                        {anime.title}
                    </Link>
                    </div>
                ))}  
                </div>    
            </div>
        </aside>
    )
}
export default Sidebar;
