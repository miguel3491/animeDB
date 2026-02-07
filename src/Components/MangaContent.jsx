import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactPaginate from "react-paginate";
import { Link } from "react-router-dom";
import MangaSidebar from "./MangaSidebar";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniList, fetchAniListMangaCoversByMalIds, getAniListMangaCoverFromCache } from "../utils/anilist";
import "../styles.css";

const SEARCH_TTL = 2 * 60 * 1000;
const TOP_TTL = 5 * 60 * 1000;
const LATEST_TTL = 5 * 60 * 1000;
const searchCache = new Map();
let topMangaCache = { data: null, ts: 0 };
let latestMangaCache = { data: null, ts: 0 };

function MangaContent() {
  const [manga, setManga] = useState([]);
  const [topManga, setTopManga] = useState([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState();
  const [currentPage, setCurrentPage] = useState(0);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const [latestManga, setLatestManga] = useState([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState("");
  const releasesRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const showMiniStrip = search.trim().length === 0;
  const [mangaCovers, setMangaCovers] = useState({});

  const obtainTopManga = async () => {
    const now = Date.now();
    if (topMangaCache.data && now - topMangaCache.ts < TOP_TTL) {
      setTopManga(topMangaCache.data);
      return;
    }
    try {
      const api = await fetch(`https://api.jikan.moe/v4/top/manga`).then((res) =>
        res.json()
      );
      const data = Array.isArray(api?.data) ? api.data : [];
      topMangaCache = { data, ts: Date.now() };
      setTopManga(data);
    } catch (error) {
      if (!topMangaCache.data) {
        setTopManga([]);
      }
    }
  };

  const searchManga = useCallback(async (page) => {
    const currentPage = page ?? 1;
    const cacheKey = `${search}|${currentPage}`;
    const cached = searchCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEARCH_TTL) {
      setManga(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    try {
      const response = await fetch(
        `https://api.jikan.moe/v4/manga?q=${search}&page=${currentPage}`
      );
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      searchCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setManga(data);
      setPageSize(pagination);
    } catch (error) {
      if (!cached) {
        setManga([]);
        setPageSize(null);
      }
    }
  }, [search]);

  const handlePageClick = async (event) => {
    const nextPage = event.selected;
    if (nextPage === currentPage) {
      return;
    }
    setCurrentPage(nextPage);
    searchManga(nextPage + 1);
  };

  useEffect(() => {
    setCurrentPage(0);
  }, [search]);

  const triggerSearch = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setCurrentPage(0);
    searchManga(1);
  };

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setCurrentPage(0);
      searchManga(1);
    }, 350);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, searchManga]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsPageLoading(false);
    }, 260);
    setIsPageLoading(true);
    return () => clearTimeout(timeout);
  }, [currentPage]);

  useEffect(() => {
    obtainTopManga();
  }, []);

  useEffect(() => {
    const fetchLatestManga = async () => {
      const now = Date.now();
      if (latestMangaCache.data && now - latestMangaCache.ts < LATEST_TTL) {
        setLatestManga(latestMangaCache.data);
        setLatestLoading(false);
        return;
      }
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
        const json = await fetchAniList({ query, variables: { page: 1, perPage: 20 } });
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
        latestMangaCache = { data: items, ts: Date.now() };
        setLatestManga(items);
      } catch (error) {
        if (latestMangaCache.data) {
          setLatestManga(latestMangaCache.data);
        } else {
          setLatestManga([]);
          setLatestError("Latest manga releases are unavailable right now.");
        }
      } finally {
        setLatestLoading(false);
      }
    };

    fetchLatestManga();
  }, []);

  useEffect(() => {
    const ids = [
      ...manga.map((item) => item?.mal_id),
      ...topManga.map((item) => item?.mal_id)
    ].filter(Boolean);
    if (ids.length === 0) return undefined;

    let active = true;
    fetchAniListMangaCoversByMalIds(ids).then((map) => {
      if (!active || map.size === 0) return;
      const next = Object.fromEntries(map);
      setMangaCovers((prev) => ({ ...prev, ...next }));
    });

    return () => {
      active = false;
    };
  }, [manga, topManga]);

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

    const cover =
      item.cover ||
      item.image ||
      item.images?.jpg?.image_url ||
      item.images?.webp?.image_url ||
      "";

    await setDoc(favoriteRef, {
      mal_id: item.mal_id,
      title: item.title,
      image: cover,
      mediaType: "manga",
      totalChapters: item.chapters ?? item.totalChapters ?? null,
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
                  triggerSearch();
                }
              }}
            />
            <button type="button" onClick={triggerSearch}>
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

          {showMiniStrip && (
            <div className="mini-strip spotlight">
            <div className="mini-strip-header">
              <div>
                <h4>Latest Manga Drops</h4>
                <p className="muted">Fresh chapters from AniList</p>
              </div>
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
                  <article className="mini-card featured" key={`mini-${item.id}`}>
                    <div className="mini-thumb">
                      {item.image ? (
                          <img src={item.image} alt={item.title} />
                        ) : (
                          <div className="mini-placeholder"></div>
                        )}
                      </div>
                      <div className="mini-card-body">
                        <span className="mini-title">{item.title}</span>
                        <span className="mini-episode">{item.chapterTitle}</span>
                        <span className="muted">
                          {item.releaseAt ? new Date(item.releaseAt).toLocaleDateString() : "TBA"}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {pageSize && (
            <div className="pagination top">
              <ReactPaginate
                nextLabel="&rarr;"
                previousLabel="&larr;"
                breakLabel={"..."}
                forcePage={currentPage}
                pageCount={pageSize?.last_visible_page}
                onPageChange={handlePageClick}
                marginPagesDisplayed={2}
                pageRangeDisplayed={5}
              />
            </div>
          )}

          {isPageLoading ? (
            <div className={`anime-grid ${viewMode}`}>
              {Array.from({ length: 8 }).map((_, index) => (
                <div className="anime-card skeleton-card" key={`manga-skeleton-${index}`}>
                  <div className="media-wrap skeleton-block"></div>
                  <div className="card-body">
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line short"></div>
                    <div className="skeleton-line"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
                }) => {
                  const cover =
                    mangaCovers[mal_id] ||
                    getAniListMangaCoverFromCache(mal_id) ||
                    images?.jpg?.image_url ||
                    images?.webp?.image_url ||
                    "";
                  return (
                  <article className="anime-card" key={mal_id}>
                    <Link to={`/manga/${mal_id}`}>
                      <div className="media-wrap">
                        {cover ? (
                          <img src={cover} alt={title} />
                        ) : (
                          <div className="media-placeholder" aria-label={`${title} cover unavailable`}></div>
                        )}
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
                        onClick={() => toggleFavorite({ mal_id, title, images, chapters, cover })}
                        disabled={!user}
                        title={user ? "Save to favorites" : "Sign in to save favorites"}
                      >
                        {favorites.has(`manga_${mal_id}`) ? "Favorited" : "Add to favorites"}
                      </button>
                    </div>
                  </div>
                </article>
              )}
            )}
          </div>

          <div className="pagination">
            {pageSize && (
              <ReactPaginate
                nextLabel="&rarr;"
                previousLabel="&larr;"
                breakLabel={"..."}
                forcePage={currentPage}
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

          <div className="episodes-section anime" ref={releasesRef}>
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
          <MangaSidebar topManga={topManga} imageMap={mangaCovers}></MangaSidebar>
        </div>
      </div>
    </div>
  );
}

export default MangaContent;
