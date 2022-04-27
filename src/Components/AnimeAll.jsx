import React from "react"

function AnimeAll({animeList}){
    return(
        <div className="AnimeCard">
            {animeList.map((card, i) => (
                <div> 
                    <a href={card.url}
                    target = "_blank"
                    rel= "noopener"><img className="Image-card" src = {card.images.jpg.image_url} alt = "Image"></img><span>{card.type}</span><h3>{card.title}</h3></a>
                </div>
            ))}
        </div>
    )
}

export default AnimeAll;