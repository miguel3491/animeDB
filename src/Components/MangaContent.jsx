import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactPaginate from "react-paginate";
import { Link } from "react-router-dom";
import MangaSidebar from "./MangaSidebar";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function MangaContent() {
  const [manga, setManga] = useState([]);
  const [topManga, setTopManga] = useState([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState();
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const [latestManga, setLatestManga] = useState([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState("");
  const releasesRef = useRef(null);

  const obtainTopManga = async () => {
    try {
      const api = await fetch(`https://api.jikan.moe/v4/top/manga`).then((res) =>
        res.json()
      );
      setTopManga(Array.isArray(api?.data) ? api.data : []);
    } catch (error) {
      setTopManga([]);
    }
  };

  const searchManga = useCallback(async (page) => {
    const currentPage = page ?? 1;
    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/manga?q=${search}&page=${currentPage}`
      );
      const apiAll = await response.json();
      setManga(apiAll?.data ?? []);
      setPageSize(apiAll?.pagination ?? null);
    } catch (error) {
      setManga([]);
      setPageSize(null);
    }
  }, [search]);

  const handlePageClick = async (event) => {
    searchManga(event.selected + 1);
  };

  useEffect(() => {
    searchManga();
  }, [searchManga]);

  useEffect(() => {
    obtainTopManga();
  }, []);

  useEffect(() => {
    const fetchLatestManga = async () => {
      setLatestLoading(true);
      setLatestError("");
      try {
        const query = `
          query ($page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
              media(type: MANGA, sort: UPDATED_AT_DESC, status_in: [RELEASING, HIATUS], isAdult: false) {
                id
                title { userPreferred english romaji }
                siteUrl
                coverImage { extraLarge large }
                chapters
                updatedAt
              }
            }
          }
        `;
        const response = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ query, variables: { page: 1, perPage: 20 } })
        });
        const json = await response.json();
        if (json?.errors?.length) {
          throw new Error(json.errors[0]?.message || "AniList error");
        }
        const media = json?.data?.Page?.media || [];
        const items = media.map((entry) => ({
          id: entry.id,
          title:
            entry?.title?.userPreferred ||
            entry?.title?.english ||
            entry?.title?.romaji ||
            "Unknown title",
          image: entry?.coverImage?.extraLarge || entry?.coverImage?.large || "",
          releaseAt: entry?.updatedAt ? entry.updatedAt * 1000 : null,
          chapterTitle: entry?.chapters ? `Chapter ${entry.chapters}` : "Chapter ?",
          url: entry?.siteUrl || ""
        }));
        setLatestManga(items);
      } catch (error) {
        setLatestManga([]);
        setLatestError("Latest manga releases are unavailable right now.");
      } finally {
        setLatestLoading(false);
      }
    };

    fetchLatestManga();
  }, []);

  const genreOptions = useMemo(() => {
    const names = new Set();
    manga.forEach((item) => {
      (item.genres || []).forEach((genre) => {
        if (genre?.name) {
          names.add(genre.name);
        }
      });
    });
    return ["All", ...Array.from(names).sort()];
  }, [manga]);

  const filteredManga = useMemo(() => {
    if (selectedGenre === "All") {
      return manga;
    }
    return manga.filter((item) =>
      (item.genres || []).some((genre) => genre.name === selectedGenre)
    );
  }, [manga, selectedGenre]);

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
    const docId = `manga_${item.mal_id}`;
    const favoriteRef = doc(db, "users", user.uid, "favorites", docId);
    const hasFavorite = favorites.has(docId);
    if (hasFavorite) {
      await deleteDoc(favoriteRef);
      return;
    }

    await setDoc(favoriteRef, {
      mal_id: item.mal_id,
      title: item.title,
      image: item.images?.jpg?.image_url || "",
      mediaType: "manga",
      totalChapters: item.chapters ?? null,
      status: "Plan to watch",
      rating: "",
      note: "",
      order: Date.now(),
      currentChapter: 0,
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <div>
      <div className="menu">
        <div className="left-filters">
          <ul id="nav-filter">
            <li>
              <Link className="Small filter-button" to="/">Anime</Link>
            </li>
            <li>
              <Link className="Small filter-button active" to="/manga">Manga</Link>
            </li>
            <li>
              <Link className="Small filter-button" to="/news">News</Link>
            </li>
            <li>
              <Link className="Small filter-button" to="/discussion">Discussion</Link>
            </li>
          </ul>
        </div>
        <div className="right-filters">
          <div className="search-wrap">
            <input
              type="search"
              placeholder="Search manga titles..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  searchManga();
                }
              }}
            />
            <button type="button" onClick={() => searchManga()}>
              Search
            </button>
          </div>
        </div>
      </div>

      <div className="layout">
        <section>
          <div className="hero">
            <h2>Discover manga that matches your mood</h2>
            <p>
              Dive into ongoing series, completed classics, and everything in between.
            </p>
          </div>

          <div className="results-bar">
            <h3>
              {search ? `Results for “${search}”` : "Trending & top matches"}
            </h3>
            <div className="results-controls">
              <span className="pill">{filteredManga.length} titles</span>
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
              <button
                type="button"
                className="scroll-button"
                onClick={() => releasesRef.current?.scrollIntoView({ behavior: "smooth" })}
              >
                Latest releases
              </button>
            </div>
          </div>

          <div className="mini-strip">
            <div className="mini-strip-header">
              <h4>Latest Manga Drops</h4>
              <button
                type="button"
                className="mini-strip-link"
                onClick={() => releasesRef.current?.scrollIntoView({ behavior: "smooth" })}
              >
                View all
              </button>
            </div>
            {latestLoading ? (
              <p className="muted">Loading latest releases…</p>
            ) : latestError ? (
              <p className="muted">{latestError}</p>
            ) : (
              <div className="mini-strip-grid">
                {latestManga.slice(0, 6).map((item) => (
                  <article className="mini-card" key={`mini-${item.id}`}>
                    {item.image ? (
                      <img src={item.image} alt={item.title} />
                    ) : (
                      <div className="mini-placeholder"></div>
                    )}
                    <div className="mini-card-body">
                      <span>{item.title}</span>
                      <span className="muted">{item.chapterTitle}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {pageSize && (
            <div className="pagination top">
              <ReactPaginate
                nextLabel="&rarr;"
                previousLabel="&larr;"
                breakLabel={"..."}
                pageCount={pageSize?.last_visible_page}
                onPageChange={handlePageClick}
                marginPagesDisplayed={2}
                pageRangeDisplayed={5}
              />
            </div>
          )}

          <div className={`anime-grid ${viewMode}`}>
            {filteredManga.map(
              ({
                mal_id,
                title,
                images,
                type,
                synopsis,
                chapters,
                volumes,
                status,
                score
              }) => (
                <article className="anime-card" key={mal_id}>
                  <Link to={`/manga/${mal_id}`}>
                    <div className="media-wrap">
                      <img src={images.jpg.image_url} alt={title} />
                    </div>
                  </Link>
                  <div className="card-body">
                    <div className="tag-row">
                      {type && <span className="tag">{type}</span>}
                      {status && <span className="tag">{status}</span>}
                    </div>
                    <Link className="card-title-link" to={`/manga/${mal_id}`}>
                      <h4 className="card-title">{title}</h4>
                    </Link>
                    <div className="card-meta">
                      <span>Chapters: {chapters ?? "?"}</span>
                      <span>Volumes: {volumes ?? "?"}</span>
                    </div>
                    <span className="score-badge">Score {score ?? "N/A"}</span>
                    <p className="synopsis">{synopsis || "No synopsis available yet."}</p>
                    <div className="card-actions">
                      <Link className="detail-link" to={`/manga/${mal_id}`}>
                        View details
                      </Link>
                      <button
                        className={`favorite-button ${favorites.has(`manga_${mal_id}`) ? "active" : ""}`}
                        type="button"
                        onClick={() => toggleFavorite({ mal_id, title, images })}
                        disabled={!user}
                        title={user ? "Save to favorites" : "Sign in to save favorites"}
                      >
                        {favorites.has(`manga_${mal_id}`) ? "Favorited" : "Add to favorites"}
                      </button>
                    </div>
                  </div>
                </article>
              )
            )}
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

          <div className="episodes-section" ref={releasesRef}>
            <div className="results-bar">
              <h3>Latest manga releases</h3>
              <span className="pill">From AniList updates</span>
            </div>
            {latestLoading ? (
              <p>Loading the latest releases…</p>
            ) : latestError ? (
              <p>{latestError}</p>
            ) : (
              <div className="episodes-grid">
                {latestManga.map((item) => (
                  <article className="episode-card" key={item.id}>
                    {item.image && (
                      <img className="episode-image" src={item.image} alt={item.title} />
                    )}
                    <div className="episode-body">
                      <h4>{item.title}</h4>
                      <div className="episode-meta">
                        <span>
                          Date: {item.releaseAt ? new Date(item.releaseAt).toLocaleDateString() : "TBA"}
                        </span>
                        <span>{item.chapterTitle}</span>
                      </div>
                      <div className="episode-actions">
                        {item.url ? (
                          <a className="detail-link" href={item.url} target="_blank" rel="noreferrer">
                            Read on AniList
                          </a>
                        ) : (
                          <span className="muted">No link available</span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="Sidebar">
          <MangaSidebar topManga={topManga}></MangaSidebar>
        </div>
      </div>
    </div>
  );
}

export default MangaContent;
