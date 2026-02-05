import React, {useState} from "react";
import ReactPlayer from 'react-player'

function AnimeCard({seasonAnime}){

    // const [pageSize, setPageSize] = useState(5);

    return(
        <div className="AnimeCard">
            {seasonAnime.map((card, i) => (
                <div>
                    <a href={card.trailer.url}
                    key = {card.mal_id}
                    target = "_blank"
                    rel= "noopener">
                    <img src = {card.images.jpg.image_url} alt = "Image"></img></a>
                    <h3>{card.title}</h3>              
                </div>
            ))}
        </div>
    )
}

export default AnimeCard;

// Filter an amount of items topAnime.map((card, i) => i < 8 && (