import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function MangaDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [manga, setManga] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [recsError, setRecsError] = useState("");
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchManga = async () => {
      try {
        const response = await fetch(`/api/jikan/full?type=manga&id=${encodeURIComponent(id)}`);
        const data = await response.json();
        if (isMounted) {
          setManga(data.data);
        }
      } catch (error) {
        if (isMounted) {
          setManga(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchManga();
    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    const cacheKey = `manga-recs-${String(id || "")}`;
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
        const res = await fetch(`/api/jikan/recommendations?type=manga&id=${encodeURIComponent(id)}`);
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(String(json?.error || "Recommendations unavailable."));
        const rows = Array.isArray(json?.data) ? json.data : [];
        const clean = rows
          .map((r) => ({
            mal_id: r?.mal_id ?? null,
            title: r?.title || "",
            image: r?.image || "",
            genres: Array.isArray(r?.genres) ? r.genres : [],
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
      const favoriteRef = doc(db, "users", user.uid, "favorites", `manga_${id}`);
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
    navigate("/manga");
  };

  if (loading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>Loading manga details...</p>
        </section>
      </div>
    );
  }

  if (!manga) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>We could not load this manga. Please try another title.</p>
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
        </section>
      </div>
    );
  }

  const toggleFavorite = async () => {
    if (!user) {
      return;
    }
    const favoriteRef = doc(db, "users", user.uid, "favorites", `manga_${manga.mal_id}`);
    if (isFavorite) {
      await deleteDoc(favoriteRef);
      setIsFavorite(false);
      return;
    }
    await setDoc(favoriteRef, {
      mal_id: manga.mal_id,
      title: manga.title,
      image: manga.images?.jpg?.image_url || "",
      mediaType: "manga",
      totalChapters: manga.chapters ?? null,
      status: "Plan to watch",
      rating: "",
      note: "",
      order: Date.now(),
      currentChapter: 0,
      updatedAt: new Date().toISOString()
    });
    setIsFavorite(true);
  };

  const formatList = (items) =>
    items && items.length ? items.map((item) => item.name).join(", ") : "None listed";
  const published = manga.published?.string || "N/A";
  const fallbackGenres = Array.isArray(manga?.genres)
    ? manga.genres.map((g) => String(g?.name || "").trim()).filter(Boolean)
    : [];

  return (
    <div className="layout detail-layout">
      <section className="detail-panel">
        <div className="detail-header">
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
          <div className="detail-actions">
            <span className="pill">Manga details</span>
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
            <img src={manga.images.jpg.image_url} alt={manga.title} />
          </div>
          <div className="detail-summary">
            <h2>{manga.title}</h2>
            {manga.title_english && <p className="detail-subtitle">{manga.title_english}</p>}
            <div className="detail-meta">
              <span>Type: {manga.type || "N/A"}</span>
              <span>Chapters: {manga.chapters ?? "N/A"}</span>
              <span>Volumes: {manga.volumes ?? "N/A"}</span>
              <span>Status: {manga.status || "N/A"}</span>
              <span>Score: {manga.score ?? "N/A"}</span>
              <span>Rating: {manga.rating || "N/A"}</span>
            </div>
            <p className="detail-synopsis">{manga.synopsis || "No synopsis available."}</p>
            <div className="tag-row">
              {manga.genres?.map((genre) => (
                <span className="tag" key={genre.mal_id}>{genre.name}</span>
              ))}
            </div>
          </div>
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
                  key={`manga-rec-${manga.mal_id}-${r.mal_id}`}
                  type="button"
                  className="detail-recs-card"
                  onClick={() =>
                    navigate(`/manga/${r.mal_id}`, {
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
                    {Array.isArray(r.genres) && r.genres.length > 0 ? (
                      <div className="detail-recs-tags">
                        {r.genres.slice(0, 2).map((g) => (
                          <span key={`manga-rec-tag-${manga.mal_id}-${r.mal_id}-${g}`} className="tag">
                            {g}
                          </span>
                        ))}
                      </div>
                    ) : fallbackGenres.length > 0 ? (
                      <div className="detail-recs-tags">
                        {fallbackGenres.slice(0, 2).map((g) => (
                          <span key={`manga-rec-fallback-tag-${manga.mal_id}-${r.mal_id}-${g}`} className="tag">
                            {g}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="detail-recs-meta muted">Genres unavailable</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="detail-aside">
        <div className="sidebar-card">
          <h4>Info Snapshot</h4>
          <div className="detail-list">
            <span>Type: {manga.type || "N/A"}</span>
            <span>Chapters: {manga.chapters ?? "N/A"}</span>
            <span>Volumes: {manga.volumes ?? "N/A"}</span>
            <span>Status: {manga.status || "N/A"}</span>
            <span>Published: {published}</span>
            <span>Authors: {formatList(manga.authors)}</span>
            <span>Serialization: {formatList(manga.serializations)}</span>
            <span>Genres: {formatList(manga.genres)}</span>
            <span>Demographic: {formatList(manga.demographics)}</span>
            <span>Score: {manga.score ?? "N/A"}</span>
            <span>Rating: {manga.rating || "N/A"}</span>
            <span>Popularity: #{manga.popularity ?? "N/A"}</span>
            <span>Rank: #{manga.rank ?? "N/A"}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default MangaDetail;
