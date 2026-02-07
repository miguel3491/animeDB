import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function MangaDetail() {
  const { id } = useParams();
  const [manga, setManga] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchManga = async () => {
      try {
        const response = await fetch(`https://api.jikan.moe/v4/manga/${id}/full`);
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
          <Link className="detail-link" to="/manga">Back to manga</Link>
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

  return (
    <div className="layout detail-layout">
      <section className="detail-panel">
        <div className="detail-header">
          <Link className="detail-link" to="/manga">&#8592; Back to manga</Link>
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
