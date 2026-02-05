import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function Favorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    const favoritesRef = collection(db, "users", user.uid, "favorites");
    const favoritesQuery = query(favoritesRef, orderBy("title", "asc"));
    const unsubscribe = onSnapshot(favoritesQuery, (snapshot) => {
      const data = snapshot.docs.map((doc) => doc.data());
      setFavorites(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (!user) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Favorites</h2>
          <p>Sign in with Google to save your favorite anime.</p>
          <Link className="detail-link" to="/">Back to search</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <section className="detail-panel">
        <div className="results-bar">
          <h3>Your favorites</h3>
          <span className="pill">{favorites.length} saved</span>
        </div>
        {loading ? (
          <p>Loading favorites...</p>
        ) : favorites.length === 0 ? (
          <p>No favorites yet. Add some from the catalog.</p>
        ) : (
          <div className="catalog-grid">
            {favorites.map((item) => (
              <Link
                className="catalog-item"
                key={`favorite-${item.mal_id}`}
                to={`/anime/${item.mal_id}`}
              >
                <img src={item.image} alt={item.title} />
                <div>
                  <span>{item.title}</span>
                  {item.hasTrailer && (
                    <span className="catalog-badge">Trailer</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Favorites;
