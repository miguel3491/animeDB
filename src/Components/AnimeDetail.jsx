import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniListCoversByMalIds, getAniListCoverFromCache } from "../utils/anilist";
import "../styles.css";

function AnimeDetail() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(false);
  const [aniCover, setAniCover] = useState("");

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

  useEffect(() => {
    if (!user) {
      setIsFavorite(false);
      return;
    }
    let isMounted = true;
    const checkFavorite = async () => {
      const favoriteRef = doc(db, "users", user.uid, "favorites", String(id));
      const snapshot = await getDoc(favoriteRef);
      if (isMounted) {
        setIsFavorite(snapshot.exists());
      }
    };
    checkFavorite();
    return () => {
      isMounted = false;
    };
  }, [id, user]);

  useEffect(() => {
    const malId = Number(anime?.mal_id);
    if (!Number.isInteger(malId)) {
      setAniCover("");
      return;
    }
    const cached = getAniListCoverFromCache(malId);
    if (cached) {
      setAniCover(cached);
      return;
    }
    let active = true;
    fetchAniListCoversByMalIds([malId]).then((map) => {
      if (!active) return;
      const cover = map.get(malId) || getAniListCoverFromCache(malId);
      setAniCover(cover || "");
    });
    return () => {
      active = false;
    };
  }, [anime?.mal_id]);

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
  const toggleFavorite = async () => {
    if (!user) {
      return;
    }
    const favoriteRef = doc(db, "users", user.uid, "favorites", String(anime.mal_id));
    if (isFavorite) {
      await deleteDoc(favoriteRef);
      setIsFavorite(false);
      return;
    }
    await setDoc(favoriteRef, {
      mal_id: anime.mal_id,
      title: anime.title,
      image: aniCover,
      hasTrailer,
      mediaType: "anime",
      totalEpisodes: anime.episodes ?? null,
      status: "Plan to watch",
      rating: "",
      note: "",
      order: Date.now(),
      currentEpisode: 0,
      updatedAt: new Date().toISOString()
    });
    setIsFavorite(true);
  };

  return (
    <div className="layout detail-layout">
      <section className="detail-panel">
        <div className="detail-header">
          <Link className="detail-link" to="/">&#8592; Back to results</Link>
          <div className="detail-actions">
            {hasTrailer && <span className="pill">Trailer available</span>}
            <button
              className={`favorite-button ${isFavorite ? "active" : ""}`}
              type="button"
              onClick={toggleFavorite}
              disabled={!user}
              title={user ? "Save to favorites" : "Sign in to save favorites"}
            >
              {isFavorite ? "Favorited" : "Add to favorites"}
            </button>
          </div>
        </div>
        <div className="detail-hero">
          <div className="detail-poster">
            {aniCover ? (
              <img src={aniCover} alt={anime.title} />
            ) : (
              <div className="detail-placeholder" aria-label={`${anime.title} cover unavailable`}></div>
            )}
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
