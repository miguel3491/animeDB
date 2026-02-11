import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniListCoversByMalIds, getAniListCoverFromCache } from "../utils/anilist";
import "../styles.css";

function AnimeDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState([]);
  const [charactersLoading, setCharactersLoading] = useState(true);
  const [charactersError, setCharactersError] = useState("");
  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState("");
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(false);
  const [aniCover, setAniCover] = useState("");

  useEffect(() => {
    let isMounted = true;
    const fetchAnime = async () => {
      try {
        const response = await fetch(`/api/jikan/full?type=anime&id=${encodeURIComponent(id)}`);
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
    let isMounted = true;
    const fetchCharacters = async () => {
      setCharactersLoading(true);
      setCharactersError("");
      try {
        const response = await fetch(`/api/jikan/characters?id=${encodeURIComponent(id)}`);
        const data = await response.json();
        if (isMounted) {
          const list = Array.isArray(data?.data) ? data.data : [];
          const sorted = [...list].sort((a, b) => (b?.favorites || 0) - (a?.favorites || 0));
          setCharacters(sorted.slice(0, 8));
        }
      } catch (error) {
        if (isMounted) {
          setCharacters([]);
          setCharactersError("Character info unavailable.");
        }
      } finally {
        if (isMounted) {
          setCharactersLoading(false);
        }
      }
    };

    fetchCharacters();
    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    const cacheKey = `anime-recs-${String(id || "")}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setRecs(parsed);
          setRecsLoading(false);
          return () => {
            active = false;
          };
        }
      }
    } catch (err) {
      // ignore
    }

    (async () => {
      setRecsLoading(true);
      setRecsError("");
      try {
        const res = await fetch(`/api/jikan/recommendations?type=anime&id=${encodeURIComponent(id)}`);
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(String(json?.error || "Recommendations unavailable."));
        const rows = Array.isArray(json?.data) ? json.data : [];
        const clean = rows
          .map((r) => ({
            mal_id: r?.mal_id ?? null,
            title: r?.title || "",
            image: r?.image || "",
            votes: r?.votes ?? 0
          }))
          .filter((r) => Number.isFinite(Number(r.mal_id)) && r.title)
          .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0))
          .slice(0, 6);
        setRecs(clean);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(clean));
        } catch (err) {
          // ignore
        }
      } catch (err) {
        if (!active) return;
        setRecs([]);
        setRecsError(err?.message || "Recommendations unavailable.");
      } finally {
        if (!active) return;
        setRecsLoading(false);
      }
    })();

    return () => {
      active = false;
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

  const goBack = () => {
    const from = location.state?.from;
    if (typeof from === "string" && from.length > 0) {
      navigate(from);
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

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
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
        </section>
      </div>
    );
  }

  const hasTrailer = Boolean(anime.trailer?.embed_url);
  const formatList = (items) =>
    items && items.length ? items.map((item) => item.name).join(", ") : "None listed";
  const premiered = anime.season ? `${anime.season} ${anime.year || ""}`.trim() : "N/A";
  const aired = anime.aired?.string || "N/A";
  const broadcast = anime.broadcast?.string || "N/A";
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
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
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
              <span>Type: {anime.type || "N/A"}</span>
              <span>Episodes: {anime.episodes ?? "N/A"}</span>
              <span>Status: {anime.status || "N/A"}</span>
              <span>Score: {anime.score ?? "N/A"}</span>
              <span>Rating: {anime.rating || "N/A"}</span>
            </div>
            <p className="detail-synopsis">{anime.synopsis || "No synopsis available."}</p>
            <div className="tag-row">
              {anime.genres?.map((genre, idx) => (
                <span className="tag" key={genre?.mal_id ?? `${genre?.name || "genre"}-${idx}`}>
                  {genre?.name || "Unknown"}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="detail-characters">
          <h3>Key Characters</h3>
          {charactersLoading ? (
            <p>Loading characters...</p>
          ) : charactersError ? (
            <p>{charactersError}</p>
          ) : characters.length === 0 ? (
            <p>No characters found for this title.</p>
          ) : (
            <div className="character-grid">
              {characters.map((entry) => (
                <div className="character-card" key={entry.character?.mal_id || entry.character?.name}>
                  {entry.character?.images?.jpg?.image_url ? (
                    <img src={entry.character.images.jpg.image_url} alt={entry.character?.name} />
                  ) : (
                    <div className="character-placeholder"></div>
                  )}
                  <div>
                    <h4>{entry.character?.name || "Unknown"}</h4>
                    <span className="muted">{entry.role || "Supporting"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="detail-recs">
          <div className="results-bar" style={{ margin: "8px 0 12px" }}>
            <h3 style={{ margin: 0 }}>Related Recommendations</h3>
            <span className="pill">Jikan</span>
          </div>
          {recsLoading ? (
            <p className="muted">Loading recommendations...</p>
          ) : recsError ? (
            <p className="muted">{recsError}</p>
          ) : recs.length === 0 ? (
            <p className="muted">No recommendations available for this title.</p>
          ) : (
            <div className="detail-recs-grid">
              {recs.map((r) => (
                <button
                  key={`anime-rec-${anime.mal_id}-${r.mal_id}`}
                  type="button"
                  className="detail-recs-card"
                  onClick={() =>
                    navigate(`/anime/${r.mal_id}`, {
                      state: { from: location.state?.from || `${location.pathname}${location.search || ""}` }
                    })
                  }
                  title="View details"
                >
                  {r.image ? (
                    <img className="detail-recs-thumb" src={r.image} alt={r.title} loading="lazy" />
                  ) : (
                    <div className="detail-recs-thumb placeholder" aria-hidden="true" />
                  )}
                  <div className="detail-recs-text">
                    <div className="detail-recs-title">{r.title}</div>
                    <div className="detail-recs-meta muted">{Number(r.votes || 0)} votes</div>
                  </div>
                </button>
              ))}
            </div>
          )}
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
            <span>Type: {anime.type || "N/A"}</span>
            <span>Episodes: {anime.episodes ?? "N/A"}</span>
            <span>Status: {anime.status || "N/A"}</span>
            <span>Aired: {aired}</span>
            <span>Premiered: {premiered}</span>
            <span>Broadcast: {broadcast}</span>
            <span>Producers: {formatList(anime.producers)}</span>
            <span>Licensors: {formatList(anime.licensors)}</span>
            <span>Studios: {formatList(anime.studios)}</span>
            <span>Source: {anime.source || "N/A"}</span>
            <span>Genres: {formatList(anime.genres)}</span>
            <span>Demographic: {formatList(anime.demographics)}</span>
            <span>Duration: {anime.duration || "N/A"}</span>
            <span>Rating: {anime.rating || "N/A"}</span>
            <span>Popularity: #{anime.popularity ?? "N/A"}</span>
            <span>Rank: #{anime.rank ?? "N/A"}</span>
          </div>
          {anime.streaming?.length ? (
            <>
              <h4>Streaming</h4>
              <div className="detail-links">
                {anime.streaming.map((stream) => (
                  <a
                    key={`${stream?.name || "stream"}-${stream?.url || ""}`}
                    href={stream.url}
                    target="_blank"
                    rel="noreferrer"
                  >
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
