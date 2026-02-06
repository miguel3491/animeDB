import React from "react";
import { Link } from "react-router-dom";

function Sidebar({topAnime}){
    const sortedTop = [...topAnime]
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
                    <img className="side-image" src = {anime.images.jpg.image_url} alt = {anime.title}></img>
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
