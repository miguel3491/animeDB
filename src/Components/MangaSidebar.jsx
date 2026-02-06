import React from "react";
import { Link } from "react-router-dom";

function MangaSidebar({ topManga }) {
  const safeTop = Array.isArray(topManga) ? topManga : [];
  const sortedTop = [...safeTop]
    .filter((manga) => manga && manga.mal_id)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .slice(0, 10);

  return (
    <aside>
      <div className="sidebar-card">
        <h4>Top Manga Series</h4>
        <div className="sidebar-scroll">
          {sortedTop.map((manga, index) => (
            <div className="sidebar-item" key={manga.mal_id}>
              <span className="side-rank">#{index + 1}</span>
              <img className="side-image" src={manga.images.jpg.image_url} alt={manga.title}></img>
              <Link className="anime-title" to={`/manga/${manga.mal_id}`}>
                {manga.title}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default MangaSidebar;
