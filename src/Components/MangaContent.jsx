import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactPaginate from "react-paginate";
import { Link, useLocation, useNavigate } from "react-router-dom";
import MangaSidebar from "./MangaSidebar";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniList, fetchAniListMangaCoversByMalIds, getAniListMangaCoverFromCache } from "../utils/anilist";
import { fetchJikanSuggestions } from "../utils/jikan";
import { logFavoriteActivity } from "../utils/favoriteActivity";
import "../styles.css";

const SEARCH_TTL = 2 * 60 * 1000;
const TOP_TTL = 5 * 60 * 1000;
const LATEST_TTL = 5 * 60 * 1000;
const DEFAULT_TTL = 5 * 60 * 1000;
const SEASON_TTL = 5 * 60 * 1000;
const searchCache = new Map();
const defaultCache = new Map();
const seasonCache = new Map();
let topMangaCache = { data: null, ts: 0, key: "" };
let latestMangaCache = { data: null, ts: 0 };

function MangaContent({ mode } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSeasonalMode = mode === "seasonal";
  const fromPath = `${location.pathname}${location.search || ""}`;
  const isAnimeActive = location.pathname === "/" || location.pathname.startsWith("/seasonal/anime");
  const isMangaActive = location.pathname === "/manga" || location.pathname.startsWith("/seasonal/manga");
  const isNewsActive = location.pathname.startsWith("/news");
  const isDiscussionActive = location.pathname.startsWith("/discussion");
  const [manga, setManga] = useState([]);
  const [topManga, setTopManga] = useState([]);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionAbortRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const [pageSize, setPageSize] = useState();
  const [currentPage, setCurrentPage] = useState(0);
  const mangaRef = useRef([]);
  const pageSizeRef = useRef(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const favoritesRef = useRef(new Set());
  const favoritesDebounceRef = useRef(null);
  const favoritesOptimisticAtRef = useRef(0);
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);
  const [latestManga, setLatestManga] = useState([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState("");
  const [searchError, setSearchError] = useState("");
  const releasesRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const searchAbortRef = useRef(null);
  const searchRequestRef = useRef(0);
  const favoritePulseTimeout = useRef(null);
  const showMiniStrip = search.trim().length === 0 && location.pathname === "/manga";
  const defaultSeason = useMemo(() => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = Math.max(2025, now.getFullYear());
    const season =
      [12, 1, 2].includes(month) ? "winter" :
      [3, 4, 5].includes(month) ? "spring" :
      [6, 7, 8].includes(month) ? "summer" :
      "fall";
    return { year, season };
  }, []);
  const [seasonYear, setSeasonYear] = useState(defaultSeason.year);
  const [seasonName, setSeasonName] = useState(defaultSeason.season);
  const [mangaCovers, setMangaCovers] = useState({});
  const [favoritePulseId, setFavoritePulseId] = useState(null);

  const obtainTopManga = async () => {
    const now = Date.now();
    const cacheKey = `${seasonYear}|${seasonName}`;
    if (topMangaCache.data && topMangaCache.key === cacheKey && now - topMangaCache.ts < TOP_TTL) {
      setTopManga(topMangaCache.data);
      return;
    }
    try {
      const response = await fetch(
        `/api/jikan/manga/seasonal?year=${encodeURIComponent(seasonYear)}&season=${encodeURIComponent(seasonName)}&page=1&limit=10`
      );
      const api = await response.json();
      const data = Array.isArray(api?.data) ? api.data : [];
      topMangaCache = { data, ts: Date.now(), key: cacheKey };
      setTopManga(data);
    } catch (error) {
      if (!topMangaCache.data || topMangaCache.key !== cacheKey) {
        setTopManga([]);
      }
    }
  };

  const loadDefaultManga = useCallback(async (page = 1) => {
    const cacheKey = `default|${page}`;
    const cached = defaultCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < DEFAULT_TTL) {
      setManga(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    try {
      setIsListLoading(true);
      const response = await fetch(`/api/jikan/top?type=manga&page=${encodeURIComponent(page)}`);
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      defaultCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setManga(data);
      setPageSize(pagination);
      setSearchError("");
    } catch (error) {
      if (!cached) {
        if (mangaRef.current.length === 0) {
          setManga([]);
          setPageSize(null);
        }
        setSearchError("Trending is unavailable right now.");
      }
    } finally {
      setIsListLoading(false);
    }
  }, []);

  const loadSeasonalManga = useCallback(async (page = 1, opts = {}) => {
    const year = Number(opts.year ?? seasonYear);
    const season = String(opts.season ?? seasonName);
    const cacheKey = `seasonal|${year}|${season}|${page}`;
    const cached = seasonCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEASON_TTL) {
      setManga(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    try {
      setIsListLoading(true);
      const response = await fetch(
        `/api/jikan/manga/seasonal?year=${encodeURIComponent(year)}&season=${encodeURIComponent(season)}&page=${encodeURIComponent(page)}&limit=20`
      );
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      seasonCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setManga(data);
      setPageSize(pagination);
      setSearchError("");
    } catch (error) {
      if (!cached) {
        if (mangaRef.current.length === 0) {
          setManga([]);
          setPageSize(null);
        }
        setSearchError("Seasonal titles are unavailable right now.");
      }
    } finally {
      setIsListLoading(false);
    }
  }, [seasonName, seasonYear]);

  useEffect(() => {
    if (!search.trim()) {
      const page = currentPage + 1;
      if (isSeasonalMode) {
        loadSeasonalManga(page);
      } else {
        loadDefaultManga(page);
      }
    }
  }, [currentPage, isSeasonalMode, loadDefaultManga, loadSeasonalManga, search]);

  const searchManga = useCallback(async (page) => {
    const currentPage = page ?? 1;
    const query = search.trim();
    if (!query) {
      setSearchError("");
      if (isSeasonalMode) {
        loadSeasonalManga(1);
      } else {
        loadDefaultManga(1);
      }
      return;
    }
    const cacheKey = `${query}|${currentPage}`;
    const cached = searchCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEARCH_TTL) {
      setManga(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++searchRequestRef.current;
    try {
      setIsListLoading(true);
      setSearchError("");
      const fields = [
        "mal_id",
        "title",
        "images",
        "genres",
        "type",
        "chapters",
        "volumes",
        "score",
        "status",
        "synopsis"
      ].join(",");
      const url = `/api/jikan?type=manga&q=${encodeURIComponent(query)}&page=${encodeURIComponent(currentPage)}&fields=${fields}`;
      let response;
      let lastStatus = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(url, { signal: controller.signal });
        lastStatus = response.status;
        if (response.ok) break;
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable) break;
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
      if (!response?.ok) {
        const status = lastStatus || response?.status || 0;
        if (status === 504) {
          throw new Error("Search timed out. Try again in a moment.");
        }
        throw new Error(`Search failed (${status || "network error"})`);
      }
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      if (requestId !== searchRequestRef.current) {
        return;
      }
      searchCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setManga(data);
      setPageSize(pagination);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!cached) {
        if (mangaRef.current.length === 0) {
          setManga([]);
          setPageSize(null);
        }
      } else {
        setManga(cached.data);
        setPageSize(cached.pagination);
      }
      setSearchError(error?.message || "Search is unavailable right now.");
    } finally {
      setIsListLoading(false);
    }
  }, [search]);

  const handlePageClick = async (event) => {
    const nextPage = event.selected;
    if (nextPage === currentPage) {
      return;
    }
    setCurrentPage(nextPage);
    if (search.trim()) {
      searchManga(nextPage + 1);
    } else {
      if (isSeasonalMode) {
        loadSeasonalManga(nextPage + 1);
      } else {
        loadDefaultManga(nextPage + 1);
      }
    }
  };

  useEffect(() => {
    setCurrentPage(0);
    setPageSize(null);
    if (!search.trim()) {
      if (isSeasonalMode) {
        loadSeasonalManga(1);
      } else {
        loadDefaultManga(1);
      }
    }
  }, [search, isSeasonalMode, loadDefaultManga, loadSeasonalManga]);

  useEffect(() => {
    if (!isSeasonalMode) return;
    if (search.trim()) return;
    setCurrentPage(0);
    setPageSize(null);
    loadSeasonalManga(1, { year: seasonYear, season: seasonName });
  }, [isSeasonalMode, loadSeasonalManga, seasonName, seasonYear, search]);

  const triggerSearch = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setCurrentPage(0);
    if (search.trim()) {
      searchManga(1);
    } else {
      if (isSeasonalMode) {
        loadSeasonalManga(1);
      } else {
        loadDefaultManga(1);
      }
    }
  };

  useEffect(() => {
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }
    if (suggestionAbortRef.current) {
      suggestionAbortRef.current.abort();
    }
    const q = search.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      return;
    }
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    setSuggestionsLoading(true);
    suggestionTimeoutRef.current = setTimeout(async () => {
      try {
        const items = await fetchJikanSuggestions({ type: "manga", query: q, signal: controller.signal });
        setSuggestions(items);
        setSuggestionsOpen(true);
      } catch (err) {
        if (err?.name !== "AbortError") {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      } finally {
        setSuggestionsLoading(false);
      }
    }, 220);

    return () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (!search.trim()) {
      setSearchError("");
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      setCurrentPage(0);
      searchManga(1);
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
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
    return () => {
      if (favoritePulseTimeout.current) {
        clearTimeout(favoritePulseTimeout.current);
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    mangaRef.current = manga;
    pageSizeRef.current = pageSize;
  }, [manga, pageSize]);

  useEffect(() => {
    obtainTopManga();
  }, [seasonName, seasonYear]);

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
    if (selectedGenre !== "All" && !genreOptions.includes(selectedGenre)) {
      setSelectedGenre("All");
    }
  }, [genreOptions, selectedGenre]);

  const seasonLabelFromIso = useCallback((value) => {
    const iso = value ? String(value).slice(0, 10) : "";
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!year || !month) return "";
    const season =
      [12, 1, 2].includes(month) ? "Winter" :
      [3, 4, 5].includes(month) ? "Spring" :
      [6, 7, 8].includes(month) ? "Summer" :
      "Fall";
    return `${season} ${year}`;
  }, []);

  const seasonOptions = useMemo(() => ([
    { value: "winter", label: "Winter" },
    { value: "spring", label: "Spring" },
    { value: "summer", label: "Summer" },
    { value: "fall", label: "Fall" }
  ]), []);

  const yearOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const maxYear = Math.max(2025, nowYear + 1);
    const list = [];
    for (let y = 2025; y <= maxYear; y += 1) list.push(y);
    return list;
  }, []);

  useEffect(() => {
    if (!user) {
      const empty = new Set();
      favoritesRef.current = empty;
      setFavorites(empty);
      return;
    }

    const favoritesCol = collection(db, "users", user.uid, "favorites");
    const unsubscribe = onSnapshot(favoritesCol, (snapshot) => {
      const favoriteIds = new Set(snapshot.docs.map((docItem) => docItem.id));
      const same =
        favoriteIds.size === favoritesRef.current.size &&
        Array.from(favoriteIds).every((id) => favoritesRef.current.has(id));
      favoritesRef.current = favoriteIds;
      if (same) {
        return;
      }
      if (favoritesDebounceRef.current) {
        clearTimeout(favoritesDebounceRef.current);
      }
      const delay = Date.now() - favoritesOptimisticAtRef.current < 350 ? 320 : 200;
      favoritesDebounceRef.current = setTimeout(() => {
        setFavorites(favoriteIds);
      }, delay);
    });

    return () => {
      unsubscribe();
      if (favoritesDebounceRef.current) {
        clearTimeout(favoritesDebounceRef.current);
      }
    };
  }, [user]);

  const toggleFavorite = async (item) => {
    if (!user) {
      return;
    }
    const docId = `manga_${item.mal_id}`;
    setFavoritePulseId(docId);
    if (favoritePulseTimeout.current) {
      clearTimeout(favoritePulseTimeout.current);
    }
    favoritePulseTimeout.current = setTimeout(() => {
      setFavoritePulseId(null);
    }, 320);
    const favoriteRef = doc(db, "users", user.uid, "favorites", docId);
    const hasFavorite = favoritesRef.current.has(docId);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (hasFavorite) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      favoritesRef.current = next;
      return next;
    });
    favoritesOptimisticAtRef.current = Date.now();
    const cover =
      item.cover ||
      item.image ||
      item.images?.jpg?.image_url ||
      item.images?.webp?.image_url ||
      "";
    if (hasFavorite) {
      await deleteDoc(favoriteRef);
      logFavoriteActivity(user.uid, {
        action: "removed",
        mediaType: "manga",
        itemKey: docId,
        mal_id: item.mal_id,
        title: item.title,
        image: cover
      });
      setToast(`Removed "${item.title}" from Favorites`);
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      toastTimeoutRef.current = setTimeout(() => {
        setToast("");
      }, 2000);
      return;
    }

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
    logFavoriteActivity(user.uid, {
      action: "added",
      mediaType: "manga",
      itemKey: docId,
      mal_id: item.mal_id,
      title: item.title,
      image: cover,
      status: "Plan to watch"
    });
    setToast(`Added "${item.title}" to Favorites`);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToast("");
    }, 2000);
  };

  return (
    <div>
      <div className="menu">
        <div className="left-filters">
          <ul id="nav-filter">
            <li className="nav-dropdown">
              <Link className={`Small filter-button has-dropdown ${isAnimeActive ? "active" : ""}`} to="/">
                Anime <span className="dropdown-caret" aria-hidden="true">▾</span>
              </Link>
              <div className="dropdown-menu" role="menu" aria-label="Anime menu">
                <Link className="dropdown-item" role="menuitem" to="/">All Anime</Link>
                <Link className="dropdown-item" role="menuitem" to="/seasonal/anime">Seasonal Anime</Link>
              </div>
            </li>
            <li className="nav-dropdown">
              <Link className={`Small filter-button has-dropdown ${isMangaActive ? "active" : ""}`} to="/manga">
                Manga <span className="dropdown-caret" aria-hidden="true">▾</span>
              </Link>
              <div className="dropdown-menu" role="menu" aria-label="Manga menu">
                <Link className="dropdown-item" role="menuitem" to="/manga">All Manga</Link>
                <Link className="dropdown-item" role="menuitem" to="/seasonal/manga">Seasonal Manga</Link>
              </div>
            </li>
            <li>
              <Link className={`Small filter-button ${isNewsActive ? "active" : ""}`} to="/news">News</Link>
            </li>
            <li>
              <Link className={`Small filter-button ${isDiscussionActive ? "active" : ""}`} to="/discussion">Discussion</Link>
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
                setSuggestionsOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSuggestionsOpen(false);
                  triggerSearch();
                }
              }}
            />
            <button type="button" onClick={triggerSearch}>
              Search
            </button>
            {suggestionsOpen && (suggestionsLoading || suggestions.length > 0) && (
              <div className="search-suggestions" role="listbox">
                {suggestionsLoading && (
                  <div className="muted" style={{ padding: "8px 10px" }}>
                    Loading suggestions...
                  </div>
                )}
                {suggestions.map((item) => (
                  <button
                    key={`manga-suggest-${item.mal_id}`}
                    type="button"
                    className="search-suggestion-item"
                    onClick={() => {
                      if (!item?.mal_id) {
                        setSearch(item.title);
                        setSuggestionsOpen(false);
                        triggerSearch();
                        return;
                      }
                      setSuggestionsOpen(false);
                      navigate(`/manga/${item.mal_id}`, { state: { from: fromPath } });
                    }}
                  >
                    {item.image ? (
                      <img className="search-suggestion-thumb" src={item.image} alt={item.title} />
                    ) : (
                      <div className="search-suggestion-thumb" aria-hidden="true"></div>
                    )}
                    <div>
                      <div className="search-suggestion-title">{item.title}</div>
                      <div className="search-suggestion-meta">
                        <span>Manga</span>
                        <span>#{item.mal_id}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="layout">
        {toast && <div className="toast">{toast}</div>}
        <section>
          <div className="hero">
            <h2>Discover manga that matches your mood</h2>
            <p>
              Dive into ongoing series, completed classics, and everything in between.
            </p>
          </div>

          <div className="results-bar">
            <h3>
              {search
                ? `Results for “${search}”`
                : isSeasonalMode
                ? `${seasonOptions.find((s) => s.value === seasonName)?.label || "Season"} ${seasonYear}`
                : "Trending & top matches"}
            </h3>
            <div className="results-controls">
              <span className="pill">{filteredManga.length} titles</span>
              {searchError && <span className="pill muted">{searchError}</span>}
              {isSeasonalMode && !isListLoading && !search.trim() && filteredManga.length === 0 && !searchError && (
                <span className="pill muted">No seasonal manga found for this season yet.</span>
              )}
              {isSeasonalMode && !search.trim() && (
                <>
                  <label className="genre-filter">
                    <span className="genre-label">Year</span>
                    <select value={seasonYear} onChange={(e) => setSeasonYear(Number(e.target.value))}>
                      {yearOptions.map((y) => (
                        <option key={`season-year-${y}`} value={y}>{y}</option>
                      ))}
                    </select>
                  </label>
                  <label className="genre-filter">
                    <span className="genre-label">Season</span>
                    <select value={seasonName} onChange={(e) => setSeasonName(e.target.value)}>
                      {seasonOptions.map((s) => (
                        <option key={`season-name-${s.value}`} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
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

          {isListLoading && !isPageLoading && (
            <div className="loading-indicator">
              <span className="loading-dot"></span>
              <span className="loading-dot"></span>
              <span className="loading-dot"></span>
              <span className="loading-text">Loading titles...</span>
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
              {filteredManga.map((item, index) => {
                const mal_id = item?.mal_id ?? null;
                const title = item?.title || "Untitled";
                const images = item?.images;
                const type = item?.type;
                const synopsis = item?.synopsis;
                const chapters = item?.chapters;
                const volumes = item?.volumes;
                const status = item?.status;
                const score = item?.score;
                const published = item?.published;
                const hasMal = Boolean(mal_id);

                const cover =
                  (hasMal && mangaCovers[mal_id]) ||
                  (hasMal && getAniListMangaCoverFromCache(mal_id)) ||
                  images?.jpg?.image_url ||
                  images?.webp?.image_url ||
                  "";
                const truncateByPercent = (text, percent) => {
                  const raw = String(text || "").trim();
                  if (!raw) return "";
                  if (raw.length <= 140) return raw;
                  const take = Math.max(80, Math.floor(raw.length * percent));
                  const sliced = raw.slice(0, take).trimEnd();
                  return sliced.endsWith("...") ? sliced : `${sliced}...`;
                };
                const fullSynopsis = synopsis || "No synopsis available yet.";
                const previewSynopsis = truncateByPercent(fullSynopsis, 0.25);
                const expandToggle = (evt) => {
                  if (viewMode !== "compact") return;
                  const el = evt?.currentTarget;
                  if (!el || !el.dataset) return;
                  el.dataset.expanded = "1";
                };
                const seasonLabel = isSeasonalMode
                  ? seasonLabelFromIso(published?.from) ||
                    `${seasonOptions.find((s) => s.value === seasonName)?.label || "Season"} ${seasonYear}`
                  : "";
                const key = hasMal
                  ? (isSeasonalMode
                      ? `manga-${mal_id}-${String(published?.from || "")}-${index}`
                      : String(mal_id))
                  : `manga-seasonal-${title}-${index}`;

                return (
                  <article className="anime-card" key={key}>
                    {hasMal ? (
                      <Link to={`/manga/${mal_id}`} state={{ from: fromPath }}>
                        <div className="media-wrap">
                          {cover ? (
                            <img src={cover} alt={title} />
                          ) : (
                            <div className="media-placeholder" aria-label={`${title} cover unavailable`}></div>
                          )}
                        </div>
                      </Link>
                    ) : (
                      <div className="media-wrap" title="Details unavailable (missing MAL id).">
                        {cover ? (
                          <img src={cover} alt={title} />
                        ) : (
                          <div className="media-placeholder" aria-label={`${title} cover unavailable`}></div>
                        )}
                      </div>
                    )}
                    <div className="card-body">
                      <div className="tag-row">
                        {seasonLabel && <span className="tag seasonal">{seasonLabel}</span>}
                        {type && <span className="tag">{type}</span>}
                        {status && <span className="tag">{status}</span>}
                      </div>
                      {hasMal ? (
                        <Link className="card-title-link" to={`/manga/${mal_id}`} state={{ from: fromPath }}>
                          <h4 className="card-title">{title}</h4>
                        </Link>
                      ) : (
                        <h4 className="card-title muted" title="Details unavailable (missing MAL id).">
                          {title}
                        </h4>
                      )}
                      <div className="card-meta">
                        <span>Chapters: {chapters ?? "?"}</span>
                        <span>Volumes: {volumes ?? "?"}</span>
                      </div>
                      <span className="score-badge">Score {score ?? "N/A"}</span>
                      <p
                        className={viewMode === "compact" ? "synopsis synopsis-toggle" : "synopsis"}
                        title={viewMode === "compact" ? fullSynopsis : ""}
                        data-expanded="0"
                        onClick={expandToggle}
                        onWheel={expandToggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") expandToggle(e);
                        }}
                        role={viewMode === "compact" ? "button" : undefined}
                        tabIndex={viewMode === "compact" ? 0 : undefined}
                        aria-label={viewMode === "compact" ? "Synopsis. Click to expand and scroll." : undefined}
                      >
                        {viewMode === "compact" ? (
                          <>
                            <span className="synopsis-preview">{previewSynopsis}</span>
                            <span className="synopsis-full">{fullSynopsis}</span>
                          </>
                        ) : (
                          fullSynopsis
                        )}
                      </p>
                      <div className="card-actions">
                        {hasMal ? (
                          <Link className="detail-link" to={`/manga/${mal_id}`} state={{ from: fromPath }}>
                            View details
                          </Link>
                        ) : (
                          <span className="muted">Details unavailable</span>
                        )}
                        <button
                          className={`favorite-button favorite-icon ${hasMal && favorites.has(`manga_${mal_id}`) ? "active" : ""} ${hasMal && favoritePulseId === `manga_${mal_id}` ? "pulse" : ""}`}
                          type="button"
                          onClick={() => {
                            if (!hasMal) return;
                            toggleFavorite({ mal_id, title, images, chapters, cover });
                          }}
                          disabled={!user || !hasMal}
                          title={
                            !hasMal
                              ? "MAL id unavailable for this title"
                              : user
                              ? favorites.has(`manga_${mal_id}`)
                                ? "Remove from favorites"
                                : "Add to favorites"
                              : "Sign in to save favorites"
                          }
                          aria-label={
                            !hasMal
                              ? "MAL id unavailable for this title"
                              : user
                              ? favorites.has(`manga_${mal_id}`)
                                ? "Remove from favorites"
                                : "Add to favorites"
                              : "Sign in to save favorites"
                          }
                        >
                          <span className="favorite-icon-symbol" aria-hidden="true">
                            {hasMal && favorites.has(`manga_${mal_id}`) ? "✓" : "+"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!isListLoading && filteredManga.length === 0 && (
                <div className="empty-state">
                  <p className="muted">
                    {isSeasonalMode
                      ? "No manga matches this season. Try a different year or season."
                      : "No titles available right now."}
                  </p>
                </div>
              )}
            </div>
          )}

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
          <MangaSidebar topManga={topManga} imageMap={mangaCovers} fromPath={fromPath}></MangaSidebar>
        </div>
      </div>
    </div>
  );
}

export default MangaContent;
