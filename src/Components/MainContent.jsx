import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "./Sidebar";
import ReactPaginate from "react-paginate";
import { Link } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniListCoversByMalIds, getAniListCoverFromCache } from "../utils/anilist";
import "../styles.css"

function MainContent() {
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState();
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [latestEpisodes, setLatestEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState("");
  const [aniCovers, setAniCovers] = useState({});
  const episodesRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const showMiniStrip = search.trim().length === 0;
  // const [seasonAnime, setseasonAnime] = useState([]);
  // const [filterAnime, setFilter] = useState([]);

  const obtainTopAnime = async () => {
    try {
      const api = await fetch(`https://api.jikan.moe/v4/top/anime`).then((res) =>
        res.json()
      );
      setTopAnime(Array.isArray(api?.data) ? api.data : []);
    } catch (error) {
      setTopAnime([]);
    }
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
    const nextPage = event.selected;
    if (nextPage === currentPage) {
      return;
    }
    setCurrentPage(nextPage);
    searchAnime(nextPage + 1); // change page
  };

  useEffect(() => {
    setCurrentPage(0);
  }, [search]);

  const triggerSearch = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setCurrentPage(0);
    searchAnime(1);
  };

  //  const searchItems = (searchValue) => {
  //   setSearch(searchValue)
  //   const filterAnime = anime.filter((anime) => {
  //     return Object.values(anime).join("").toLowerCase().includes(search.toLowerCase())
  //   })
  //   setFilter(filterAnime)
  // }

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setCurrentPage(0);
      searchAnime(1);
    }, 350);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, searchAnime]);

  useEffect(() => {
    obtainTopAnime();
  }, []);

  useEffect(() => {
    const ids = [
      ...anime.map((item) => item?.mal_id),
      ...topAnime.map((item) => item?.mal_id)
    ].filter(Boolean);
    if (ids.length === 0) return undefined;

    let active = true;
    fetchAniListCoversByMalIds(ids).then((map) => {
      if (!active || map.size === 0) return;
      const next = Object.fromEntries(map);
      setAniCovers((prev) => ({ ...prev, ...next }));
    });

    return () => {
      active = false;
    };
  }, [anime, topAnime]);

  useEffect(() => {
    const fetchLatestEpisodes = async () => {
      setEpisodesLoading(true);
      setEpisodesError("");
      try {
        const now = Math.floor(Date.now() / 1000);
        const twoWeeks = 14 * 24 * 60 * 60;
        const variables = {
          page: 1,
          perPage: 20,
          from: now - twoWeeks,
          to: now + 24 * 60 * 60
        };
        const query = `
          query ($page: Int, $perPage: Int, $from: Int, $to: Int) {
            Page(page: $page, perPage: $perPage) {
              airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) {
                id
                airingAt
                episode
                media {
                  id
                  title { userPreferred english romaji }
                  siteUrl
                  coverImage { extraLarge large }
                  streamingEpisodes { title thumbnail url site }
                }
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
          body: JSON.stringify({ query, variables })
        });
        const json = await response.json();
        if (json?.errors?.length) {
          throw new Error(json.errors[0]?.message || "AniList error");
        }
        const schedules = json?.data?.Page?.airingSchedules || [];
        const items = schedules.map((schedule) => {
          const media = schedule?.media || {};
          const title =
            media?.title?.userPreferred ||
            media?.title?.english ||
            media?.title?.romaji ||
            "Unknown title";
          const streams = Array.isArray(media?.streamingEpisodes)
            ? media.streamingEpisodes
            : [];
          const match = streams.find((ep) =>
            ep?.title?.toLowerCase().includes(`episode ${schedule?.episode || ""}`.toLowerCase())
          );
          const chosen = match || streams[0] || null;
          return {
            id: schedule?.id || `${media?.id || "unknown"}-${schedule?.episode || "ep"}`,
            animeTitle: title,
            animeUrl: media?.siteUrl || "",
            image: media?.coverImage?.extraLarge || media?.coverImage?.large || "",
            episodeTitle: schedule?.episode ? `Episode ${schedule.episode}` : "Episode",
            releaseAt: schedule?.airingAt ? schedule.airingAt * 1000 : null,
            watchUrl: chosen?.url || "",
            watchSite: chosen?.site || ""
          };
        });
        setLatestEpisodes(items);
      } catch (error) {
        setLatestEpisodes([]);
        setEpisodesError("Latest episodes are unavailable right now.");
      } finally {
        setEpisodesLoading(false);
      }
    };

    fetchLatestEpisodes();
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
    const cover =
      aniCovers[item.mal_id] ||
      getAniListCoverFromCache(item.mal_id) ||
      "";
    if (hasFavorite) {
      await deleteDoc(favoriteRef);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return;
    }

    await setDoc(favoriteRef, {
      mal_id: item.mal_id,
      title: item.title,
      image: cover,
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
    const cover =
      aniCovers[mal_id] ||
      getAniListCoverFromCache(mal_id) ||
      item?.images?.jpg?.image_url ||
      item?.images?.webp?.image_url ||
      "";

    return (
      <article className="anime-card" key={mal_id}>
        <Link to={`/anime/${mal_id}`}>
          <div
            className="media-wrap"
            onMouseEnter={() => setShowTrailer(true)}
            onMouseLeave={() => setShowTrailer(false)}
          >
            {cover ? (
              <img src={cover} alt={title} />
            ) : (
              <div className="media-placeholder" aria-label={`${title} cover unavailable`}></div>
            )}
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
            <li>
              <Link className="Small filter-button" to="/discussion">Discussion</Link>
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
              <button
                type="button"
                className="scroll-button"
                onClick={() => episodesRef.current?.scrollIntoView({ behavior: "smooth" })}
              >
                Latest releases
              </button>
            </div>
          </div>

          {showMiniStrip && (
            <div className="mini-strip spotlight">
            <div className="mini-strip-header">
              <div>
                <h4>Latest Anime Drops</h4>
                <p className="muted">Fresh episodes from AniList</p>
              </div>
              <button
                type="button"
                className="mini-strip-link"
                onClick={() => episodesRef.current?.scrollIntoView({ behavior: "smooth" })}
              >
                View all
              </button>
            </div>
            {episodesLoading ? (
              <p className="muted">Loading latest releases…</p>
            ) : episodesError ? (
              <p className="muted">{episodesError}</p>
            ) : (
              <div className="mini-strip-grid">
                {latestEpisodes.slice(0, 6).map((item) => (
                  <article className="mini-card featured" key={`anime-mini-${item.id}`}>
                    <div className="mini-thumb">
                      {item.image ? (
                          <img src={item.image} alt={item.animeTitle} />
                        ) : (
                          <div className="mini-placeholder"></div>
                        )}
                      </div>
                      <div className="mini-card-body">
                        <span className="mini-title">{item.animeTitle}</span>
                        <span className="mini-episode">{item.episodeTitle}</span>
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

          <div className="episodes-section anime" id="latest-episodes" ref={episodesRef}>
            <div className="results-bar">
              <h3>Latest episode releases</h3>
              <span className="pill">From AniList airing schedule</span>
            </div>
            {episodesLoading ? (
              <p>Loading the latest releases…</p>
            ) : episodesError ? (
              <p>{episodesError}</p>
            ) : (
              <div className="episodes-grid">
                {latestEpisodes.map((item) => (
                  <article className="episode-card" key={item.id}>
                    {item.image && (
                      <img className="episode-image" src={item.image} alt={item.animeTitle} />
                    )}
                    <div className="episode-body">
                      <h4>{item.animeTitle}</h4>
                      <div className="episode-meta">
                        <span>
                          Date: {item.releaseAt ? new Date(item.releaseAt).toLocaleString() : "TBA"}
                        </span>
                        <span>{item.episodeTitle}</span>
                      </div>
                      <div className="episode-actions">
                        {item.animeUrl && (
                          <a className="detail-link" href={item.animeUrl} target="_blank" rel="noreferrer">
                            Anime page
                          </a>
                        )}
                        {item.watchUrl ? (
                          <a className="detail-link" href={item.watchUrl} target="_blank" rel="noreferrer">
                            Watch {item.watchSite ? `(${item.watchSite})` : "episode"}
                          </a>
                        ) : (
                          <span className="muted">No streaming link</span>
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
          <Sidebar
            topAnime={(Array.isArray(topAnime) ? topAnime : []).slice(0, 10)}
            imageMap={aniCovers}
          ></Sidebar>
        </div>
      </div>
    </div>
  );
}

export default MainContent;

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae
