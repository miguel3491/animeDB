import React from "react";

function AnimeCard({topAnime}){
    return(
        <div className="AnimeCard">
            {topAnime.map((card, i) => (
                <div> 
                    <a href={card.url}
                    target = "_blank"
                    rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img><span>{card.type}</span><h3>{card.title}</h3></a>
                </div>
            ))}
        </div>
    )
}

export default AnimeCard;

// Filter an amount of items topAnime.map((card, i) => i < 8 && (