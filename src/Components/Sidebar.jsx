import React from "react";

function Sidebar({topAnime}){
    return(
        <aside>
            <div className="sidebar-card">
                <h4>Top Anime Series</h4>
                {topAnime.map(anime => (
                    <div className="sidebar-item" key={anime.mal_id}>
                    <span className="side-rank">#{anime.rank}</span>
                    <img className="side-image" src = {anime.images.jpg.image_url} alt = {anime.title}></img>
                    <a className="anime-title"
                    key = {anime.mal_id}
                    href = {anime.url}
                    target = "_blank"
                    rel="noreferrer">
                    {anime.title}
                    </a>
                    </div>
                ))}      
            </div>
        </aside>
    )
}
export default Sidebar;
