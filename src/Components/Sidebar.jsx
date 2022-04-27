import React from "react";

function Sidebar({topAnime}){
    return(
        <aside>
            <nav>
                <h4>Top Animes</h4>
                {topAnime.map(anime => (
                    <div>
                    <img className="side-image" src = {anime.images.jpg.image_url} alt = "Image"></img>
                    <a className="anime-title"
                    key = {anime.mal_id}
                    href = {anime.url}
                    target = "_blank">
                    {anime.title}
                    </a>
                    </div>
                ))}      
            </nav>
        </aside>
    )
}
export default Sidebar;