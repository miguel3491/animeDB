import React from "react";

function AnimeCard(props){

    return(
        <div className="AnimeCard">
            {props.topAnime.map((card, i) => (
                <div> 
                    <a href={card.url}
                    key = {card.mal_id}
                    target = "_blank"
                    rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img></a>
                    <span>{card.type}</span><h3>{card.title}</h3>
                </div>
            ))}
        </div>
    )
}

export default AnimeCard;

// Filter an amount of items topAnime.map((card, i) => i < 8 && (