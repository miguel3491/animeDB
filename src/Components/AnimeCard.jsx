import React from 'react';

function AnimeCard({ seasonAnime }) {
  return (
    <div className="AnimeCard">
      {seasonAnime.map((card) => (
        <div key={card.mal_id}>
          <a href={card.trailer.url} target="_blank" rel="noreferrer noopener">
            <img src={card.images.jpg.image_url} alt={card.title} />
          </a>
          <h3>{card.title}</h3>
        </div>
      ))}
    </div>
  );
}

export default AnimeCard;
