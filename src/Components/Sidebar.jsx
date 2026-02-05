import React from 'react';

function Sidebar({ topAnime }) {
  return (
    <aside>
      <nav className="aside-bar">
        <h4 id="h4-side">Top Anime Series</h4>
        {topAnime.map((anime) => (
          <div className="aside-bar" key={anime.mal_id}>
            <span id="side-rank">{anime.rank}</span>
            <img className="side-image" src={anime.images.jpg.image_url} alt={anime.title} />
            <a className="anime-title" href={anime.url} target="_blank" rel="noreferrer noopener">
              {anime.title}
            </a>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
