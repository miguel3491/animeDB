import React from "react";

function AnimeCard({seasonAnime}){

    // const [pageSize, setPageSize] = useState(5);

    return(
        <div className="AnimeCard">
            {seasonAnime.map((card, i) => (
                <div>
                    <a href={card.trailer.url}
                    key = {card.mal_id}
                    target = "_blank"
                    rel= "noreferrer">
                    <img src = {card.images.jpg.image_url} alt = {card.title}></img></a>
                    <h3>{card.title}</h3>              
                </div>
            ))}
        </div>
    )
}

export default AnimeCard;

// Filter an amount of items topAnime.map((card, i) => i < 8 && (
