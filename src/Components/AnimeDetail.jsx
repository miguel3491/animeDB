import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "../styles.css";

function AnimeDetail() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchAnime = async () => {
      try {
        const response = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`);
        const data = await response.json();
        if (isMounted) {
          setAnime(data.data);
        }
      } catch (error) {
        if (isMounted) {
          setAnime(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchAnime();
    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>Loading anime details...</p>
        </section>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>We could not load this anime. Please try another title.</p>
          <Link className="detail-link" to="/">Back to search</Link>
        </section>
      </div>
    );
  }

  const hasTrailer = Boolean(anime.trailer?.embed_url);

  return (
    <div className="layout detail-layout">
      <section className="detail-panel">
        <div className="detail-header">
          <Link className="detail-link" to="/">&#8592; Back to results</Link>
          {hasTrailer && <span className="pill">Trailer available</span>}
        </div>
        <div className="detail-hero">
          <div className="detail-poster">
            <img src={anime.images.jpg.image_url} alt={anime.title} />
          </div>
          <div className="detail-summary">
            <h2>{anime.title}</h2>
            {anime.title_english && <p className="detail-subtitle">{anime.title_english}</p>}
            <div className="detail-meta">
              <span>Type: {anime.type || "?"}</span>
              <span>Episodes: {anime.episodes ?? "?"}</span>
              <span>Status: {anime.status || "?"}</span>
              <span>Score: {anime.score ?? "N/A"}</span>
              <span>Rating: {anime.rating || "?"}</span>
            </div>
            <p className="detail-synopsis">{anime.synopsis || "No synopsis available."}</p>
            <div className="tag-row">
              {anime.genres?.map((genre) => (
                <span className="tag" key={genre.mal_id}>{genre.name}</span>
              ))}
            </div>
          </div>
        </div>

        {hasTrailer && (
          <div className="detail-trailer">
            <h3>Official Trailer</h3>
            <div className="detail-trailer-frame">
              <iframe
                src={anime.trailer.embed_url}
                title={`${anime.title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              ></iframe>
            </div>
          </div>
        )}
      </section>

      <aside className="detail-aside">
        <div className="sidebar-card">
          <h4>Info Snapshot</h4>
          <div className="detail-list">
            <span>Studios: {anime.studios?.map((studio) => studio.name).join(", ") || "?"}</span>
            <span>Source: {anime.source || "?"}</span>
            <span>Duration: {anime.duration || "?"}</span>
            <span>Season: {anime.season ? `${anime.season} ${anime.year}` : "?"}</span>
            <span>Popularity: #{anime.popularity ?? "?"}</span>
            <span>Rank: #{anime.rank ?? "?"}</span>
          </div>
          {anime.streaming?.length ? (
            <>
              <h4>Streaming</h4>
              <div className="detail-links">
                {anime.streaming.map((stream) => (
                  <a key={stream.name} href={stream.url} target="_blank" rel="noreferrer">
                    {stream.name}
                  </a>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export default AnimeDetail;
