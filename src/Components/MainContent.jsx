import React, { useMemo, useState, useEffect, useCallback } from "react";
import Sidebar from "./Sidebar";
import ReactPaginate from "react-paginate";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css"

function MainContent() {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState();
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  // const [seasonAnime, setseasonAnime] = useState([]);
  // const [filterAnime, setFilter] = useState([]);

  const obtainTopAnime = async () => {
    const api = await fetch(`https://api.jikan.moe/v4/top/anime`).then((res) =>
      res.json()
    );
    setTopAnime(api.data);
  };

  // const obtainSeasonalAnime = async () => {
  //   const apiData = await fetch(
  //     `https://api.jikan.moe/v4/seasons/2022/fall`
  //   ).then((res) => res.json());
  //   setseasonAnime(apiData.data);
  // };

  const searchAnime = useCallback(async (page) => {
    const currentPage = page ?? 1; // default page is 1
    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/anime?q=${search}&page=${currentPage}`
      );
      const apiAll = await response.json();
      setAnime(apiAll?.data ?? []);
      setPageSize(apiAll?.pagination ?? null);
    } catch (error) {
      setAnime([]);
      setPageSize(null);
    }
  }, [search]);

  const handlePageClick = async (event) => {
    searchAnime(event.selected + 1); // change page
  };

  //  const searchItems = (searchValue) => {
  //   setSearch(searchValue)
  //   const filterAnime = anime.filter((anime) => {
  //     return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
  //   })
  //   setFilter(filterAnime)
  // }

  useEffect(() => {
    searchAnime();
  }, [searchAnime]);

  useEffect(() => {
    obtainTopAnime();
  }, []);

  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      return;
    }

    const favoritesRef = collection(db, "users", user.uid, "favorites");
    const unsubscribe = onSnapshot(favoritesRef, (snapshot) => {
      const favoriteIds = new Set(snapshot.docs.map((docItem) => docItem.id));
      setFavorites(favoriteIds);
    });

    return () => unsubscribe();
  }, [user]);

  const toggleFavorite = async (item) => {
    if (!user) {
      return;
    }
    const scrollY = window.scrollY;
    const favoriteRef = doc(db, "users", user.uid, "favorites", String(item.mal_id));
    const hasFavorite = favorites.has(String(item.mal_id));
    if (hasFavorite) {
      await deleteDoc(favoriteRef);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return;
    }

    await setDoc(favoriteRef, {
      mal_id: item.mal_id,
      title: item.title,
      image: item.images?.jpg?.image_url || "",
      hasTrailer: Boolean(item.trailer?.embed_url),
      mediaType: "anime",
      totalEpisodes: item.episodes ?? null,
      status: "Plan to watch",
      rating: "",
      note: "",
      order: Date.now(),
      currentEpisode: 0,
      updatedAt: new Date().toISOString()
    });
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  const genreOptions = useMemo(() => {
    const names = new Set();
    anime.forEach((item) => {
      (item.genres || []).forEach((genre) => {
        if (genre?.name) {
          names.add(genre.name);
        }
      });
    });
    return ["All", ...Array.from(names).sort()];
  }, [anime]);

  const filteredAnime = useMemo(() => {
    if (selectedGenre === "All") {
      return anime;
    }
    return anime.filter((item) =>
      (item.genres || []).some((genre) => genre.name === selectedGenre)
    );
  }, [anime, selectedGenre]);

  const AnimeCardItem = ({ item }) => {
    const [showTrailer, setShowTrailer] = useState(false);
    const {
      mal_id,
      title,
      images,
      trailer,
      type,
      synopsis,
      episodes,
      source,
      score,
      duration
    } = item;
    const hasTrailer = Boolean(trailer?.embed_url);
    const isFavorite = favorites.has(String(mal_id));

    return (
      <article className="anime-card" key={mal_id}>
        <Link to={`/anime/${mal_id}`}>
          <div
            className="media-wrap"
            onMouseEnter={() => setShowTrailer(true)}
            onMouseLeave={() => setShowTrailer(false)}
          >
            <img src={images.jpg.image_url} alt={title} />
            {hasTrailer && (
              <span className="trailer-badge">Trailer Available</span>
            )}
            {hasTrailer && showTrailer && (
              <iframe
                className="trailer-frame"
                src={trailer.embed_url}
                title={`${title} trailer`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              ></iframe>
            )}
          </div>
        </Link>
        <div className="card-body">
          <div className="tag-row">
            {type && <span className="tag">{type}</span>}
            {source && <span className="tag">{source}</span>}
          </div>
          <Link className="card-title-link" to={`/anime/${mal_id}`}>
            <h4 className="card-title">{title}</h4>
          </Link>
          <div className="card-meta">
            <span>Episodes: {episodes ?? "?"}</span>
            <span>Duration: {duration ? duration.replace("ep", "episodes") : "?"}</span>
          </div>
          {hasTrailer ? (
            <span className="card-callout">Hover the image to preview the trailer.</span>
          ) : (
            <span className="card-callout muted">Trailer not available yet.</span>
          )}
          <span className="score-badge">Score {score ?? "N/A"}</span>
          <p className="synopsis">{synopsis || "No synopsis available yet."}</p>
          <div className="card-actions">
            <Link className="detail-link" to={`/anime/${mal_id}`}>
              View details
            </Link>
            <button
              className={`favorite-button ${isFavorite ? "active" : ""}`}
              type="button"
              onClick={() => toggleFavorite(item)}
              disabled={!user}
              title={user ? "Save to favorites" : "Sign in to save favorites"}
            >
              {isFavorite ? "Favorited" : "Add to favorites"}
            </button>
          </div>
        </div>
      </article>
    );
  };

  // useEffect(() => {
  //   obtainSeasonalAnime();
  // }, []);

  return (
    <div>
      <div className="menu">
        <div className="left-filters">
          <ul id="nav-filter">
            <li>
              <Link className="Small filter-button active" to="/">Anime</Link>
            </li>
            <li>
              <Link className="Small filter-button" to="/manga">Manga</Link>
            </li>
            <li>
              <Link className="Small filter-button" to="/news">News</Link>
            </li>
          </ul>
        </div>
        <div className="right-filters">
          <div className="search-wrap">
            <input
              type="search"
              placeholder="Search for your next favorite..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  searchAnime();
                }
              }}
            />
            <button type="button" onClick={() => searchAnime()}>
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="layout">
        <section>
          <div className="hero">
            <h2>Discover anime that matches your mood</h2>
            <p>
              Explore stories, studios, and scores with a layout inspired by neon
              arcades and midnight cityscapes.
            </p>
          </div>

          <div className="results-bar">
            <h3>
              {search ? `Results for “${search}”` : "Trending & top matches"}
            </h3>
            <div className="results-controls">
              <span className="pill">{filteredAnime.length} titles</span>
              <label className="genre-filter">
                <span className="genre-label">Genre</span>
                <select
                  value={selectedGenre}
                  onChange={(e) => setSelectedGenre(e.target.value)}
                >
                  {genreOptions.map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                </select>
              </label>
              <div className="view-toggle">
                <button
                  type="button"
                  className={viewMode === "grid" ? "active" : ""}
                  onClick={() => setViewMode("grid")}
                  aria-label="Grid view"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                  </svg>
                </button>
                <button
                  type="button"
                  className={viewMode === "list" ? "active" : ""}
                  onClick={() => setViewMode("list")}
                  aria-label="List view"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="3" rx="1.5"></rect>
                    <rect x="4" y="10.5" width="16" height="3" rx="1.5"></rect>
                    <rect x="4" y="16" width="16" height="3" rx="1.5"></rect>
                  </svg>
                </button>
                <button
                  type="button"
                  className={viewMode === "compact" ? "active" : ""}
                  onClick={() => setViewMode("compact")}
                  aria-label="Compact view"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="4" width="6" height="6" rx="1.2"></rect>
                    <rect x="10" y="4" width="4" height="6" rx="1"></rect>
                    <rect x="15" y="4" width="6" height="6" rx="1.2"></rect>
                    <rect x="3" y="14" width="6" height="6" rx="1.2"></rect>
                    <rect x="10" y="14" width="4" height="6" rx="1"></rect>
                    <rect x="15" y="14" width="6" height="6" rx="1.2"></rect>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className={`anime-grid ${viewMode}`}>
            {filteredAnime.map((item) => (
              <AnimeCardItem item={item} key={item.mal_id} />
            ))}
          </div>

          <div className="pagination">
            {pageSize && (
              <ReactPaginate
                nextLabel="&rarr;"
                previousLabel="&larr;"
                breakLabel={"..."}
                pageCount={pageSize?.last_visible_page}
                onPageChange={handlePageClick}
                marginPagesDisplayed={2}
                pageRangeDisplayed={5}
              />
            )}
            {pageSize && (
              <div style={{ color: "white" }}>
                Current page: {pageSize?.current_page}
              </div>
            )}
          </div>

          <div className="catalog-section">
            <div className="results-bar">
              <h3>Anime catalog (A–Z)</h3>
              <span className="pill">Sorted alphabetically</span>
            </div>
            <div className="catalog-grid">
              {[...filteredAnime]
                .filter((item) => item?.title)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((item) => (
                  <Link
                    className="catalog-item"
                    key={`catalog-${item.mal_id}`}
                    to={`/anime/${item.mal_id}`}
                  >
                    <img src={item.images.jpg.image_url} alt={item.title} />
                    <div>
                      <span>{item.title}</span>
                      {item.trailer?.embed_url && (
                        <span className="catalog-badge">Trailer</span>
                      )}
                    </div>
                  </Link>
                ))}
            </div>
          </div>
        </section>

        <div className="Sidebar">
          <Sidebar topAnime={topAnime.slice(0, 10)}></Sidebar>
        </div>
      </div>
    </div>
  );
}

export default MainContent;

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae
