import React from "react";

function Sidebar({topAnime}){
    return(
        <aside>
            <nav>
                <h4>All-time Popular</h4>
                {topAnime.map(anime => (
                    <div>
                    {/* <span id="side-rank">{anime.rank}</span> */}
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