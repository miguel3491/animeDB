import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "./Sidebar";
import ReactPaginate from "react-paginate";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniList, fetchAniListCoversByMalIds, getAniListCoverFromCache } from "../utils/anilist";
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
let topAnimeCache = { data: null, ts: 0 };
let latestEpisodesCache = { data: null, ts: 0 };

function MainContent({ mode } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSeasonalMode = mode === "seasonal";
  const fromPath = `${location.pathname}${location.search || ""}`;
  const isAnimeActive = location.pathname === "/" || location.pathname.startsWith("/seasonal/anime");
  const isMangaActive = location.pathname === "/manga" || location.pathname.startsWith("/seasonal/manga");
  const isNewsActive = location.pathname.startsWith("/news");
  const isDiscussionActive = location.pathname.startsWith("/discussion");
  const [anime, setAnime] = useState([]);
  const [topAnime, setTopAnime] = useState([]);
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionAbortRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const [pageSize, setPageSize] = useState();
  const [currentPage, setCurrentPage] = useState(0);
  const animeRef = useRef([]);
  const pageSizeRef = useRef(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [latestEpisodes, setLatestEpisodes] = useState([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [aniCovers, setAniCovers] = useState({});
  const episodesRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const searchAbortRef = useRef(null);
  const searchRequestRef = useRef(0);
  const favoritePulseTimeout = useRef(null);
  const { user } = useAuth();
  const [favorites, setFavorites] = useState(new Set());
  const favoritesRef = useRef(new Set());
  const favoritesDebounceRef = useRef(null);
  const favoritesOptimisticAtRef = useRef(0);
  const [favoritePulseId, setFavoritePulseId] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);
  const showMiniStrip = search.trim().length === 0 && location.pathname === "/";
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
  // const [seasonAnime, setseasonAnime] = useState([]);
  // const [filterAnime, setFilter] = useState([]);

  const obtainTopAnime = async () => {
    const now = Date.now();
    if (topAnimeCache.data && now - topAnimeCache.ts < TOP_TTL) {
      setTopAnime(topAnimeCache.data);
      return;
    }
    try {
      const response = await fetch(`/api/jikan/season?limit=10`);
      const api = await response.json();
      const data = Array.isArray(api?.data) ? api.data : [];
      topAnimeCache = { data, ts: Date.now() };
      setTopAnime(data);
    } catch (error) {
      if (!topAnimeCache.data) {
        setTopAnime([]);
      }
    }
  };

  // const obtainSeasonalAnime = async () => {
  //   const apiData = await fetch(
  //     `https://api.jikan.moe/v4/seasons/2022/fall`
  //   ).then((res) => res.json());
  //   setseasonAnime(apiData.data);
  // };

  const loadDefaultAnime = useCallback(async (page = 1) => {
    const cacheKey = `default|${page}`;
    const cached = defaultCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < DEFAULT_TTL) {
      setAnime(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    try {
      setIsListLoading(true);
      const response = await fetch(`/api/jikan/top?type=anime&page=${encodeURIComponent(page)}`);
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      defaultCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setAnime(data);
      setPageSize(pagination);
      setSearchError("");
    } catch (error) {
      if (!cached) {
        if (animeRef.current.length === 0) {
          setAnime([]);
          setPageSize(null);
        }
        setSearchError("Trending is unavailable right now.");
      }
    } finally {
      setIsListLoading(false);
    }
  }, []);

  const loadSeasonalAnime = useCallback(async (page = 1, opts = {}) => {
    const year = Number(opts.year ?? seasonYear);
    const season = String(opts.season ?? seasonName);
    const cacheKey = `seasonal|${year}|${season}|${page}`;
    const cached = seasonCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEASON_TTL) {
      setAnime(cached.data);
      setPageSize(cached.pagination);
      return;
    }
    try {
      setIsListLoading(true);
      const response = await fetch(
        `/api/jikan/anime/seasonal?year=${encodeURIComponent(year)}&season=${encodeURIComponent(season)}&page=${encodeURIComponent(page)}&limit=20`
      );
      const apiAll = await response.json();
      const data = apiAll?.data ?? [];
      const pagination = apiAll?.pagination ?? null;
      seasonCache.set(cacheKey, { data, pagination, ts: Date.now() });
      setAnime(data);
      setPageSize(pagination);
      setSearchError("");
    } catch (error) {
      if (!cached) {
        if (animeRef.current.length === 0) {
          setAnime([]);
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
        loadSeasonalAnime(page);
      } else {
        loadDefaultAnime(page);
      }
    }
  }, [currentPage, isSeasonalMode, loadDefaultAnime, loadSeasonalAnime, search]);

  const searchAnime = useCallback(async (page) => {
    const currentPage = page ?? 1; // default page is 1
    const query = search.trim();
    if (!query) {
      setSearchError("");
      if (isSeasonalMode) {
        loadSeasonalAnime(1);
      } else {
        loadDefaultAnime(1);
      }
      return;
    }
    const cacheKey = `${query}|${currentPage}`;
    const cached = searchCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEARCH_TTL) {
      setAnime(cached.data);
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
        "episodes",
        "score",
        "duration",
        "source",
        "status",
        "synopsis",
        "trailer"
      ].join(",");
      const url = `/api/jikan?type=anime&q=${encodeURIComponent(query)}&page=${encodeURIComponent(currentPage)}&fields=${fields}`;
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
      setAnime(data);
      setPageSize(pagination);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!cached) {
        if (animeRef.current.length === 0) {
          setAnime([]);
          setPageSize(null);
        }
      } else {
        setAnime(cached.data);
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
      searchAnime(nextPage + 1); // change page
    } else {
      if (isSeasonalMode) {
        loadSeasonalAnime(nextPage + 1);
      } else {
        loadDefaultAnime(nextPage + 1);
      }
    }
  };

  useEffect(() => {
    setCurrentPage(0);
    setPageSize(null);
    if (!search.trim()) {
      if (isSeasonalMode) {
        loadSeasonalAnime(1);
      } else {
        loadDefaultAnime(1);
      }
    }
  }, [search, isSeasonalMode, loadDefaultAnime, loadSeasonalAnime]);

  useEffect(() => {
    if (!isSeasonalMode) return;
    if (search.trim()) return;
    setCurrentPage(0);
    setPageSize(null);
    loadSeasonalAnime(1, { year: seasonYear, season: seasonName });
  }, [isSeasonalMode, loadSeasonalAnime, seasonName, seasonYear, search]);

  const triggerSearch = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    setCurrentPage(0);
    if (search.trim()) {
      searchAnime(1);
    } else {
      if (isSeasonalMode) {
        loadSeasonalAnime(1);
      } else {
        loadDefaultAnime(1);
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
        const items = await fetchJikanSuggestions({ type: "anime", query: q, signal: controller.signal });
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
    if (!search.trim()) {
      setSearchError("");
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      setCurrentPage(0);
      searchAnime(1);
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
    };
  }, [search, searchAnime]);

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
    animeRef.current = anime;
    pageSizeRef.current = pageSize;
  }, [anime, pageSize]);

  useEffect(() => {
    obtainTopAnime();
  }, []);

  useEffect(() => {
    const itemMap = new Map();
    [...anime, ...topAnime].forEach((item) => {
      if (item?.mal_id) {
        itemMap.set(item.mal_id, item);
      }
    });
    const ids = Array.from(itemMap.keys()).filter((id) => {
      const item = itemMap.get(id);
      const hasImage =
        item?.images?.jpg?.image_url ||
        item?.images?.webp?.image_url ||
        false;
      return !hasImage && !getAniListCoverFromCache(id);
    });
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
    const controller = new AbortController();
    const fetchLatestEpisodes = async () => {
      const nowMs = Date.now();
      if (latestEpisodesCache.data && nowMs - latestEpisodesCache.ts < LATEST_TTL) {
        setLatestEpisodes(latestEpisodesCache.data);
        setEpisodesLoading(false);
        return;
      }
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
        const json = await fetchAniList({ query, variables });
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
        latestEpisodesCache = { data: items, ts: Date.now() };
        setLatestEpisodes(items);
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (latestEpisodesCache.data) {
          setLatestEpisodes(latestEpisodesCache.data);
        } else {
          setLatestEpisodes([]);
          setEpisodesError("Latest episodes are unavailable right now.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setEpisodesLoading(false);
        }
      }
    };

    fetchLatestEpisodes();
    return () => controller.abort();
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
    setFavoritePulseId(String(item.mal_id));
    if (favoritePulseTimeout.current) {
      clearTimeout(favoritePulseTimeout.current);
    }
    favoritePulseTimeout.current = setTimeout(() => {
      setFavoritePulseId(null);
    }, 320);
    const scrollY = window.scrollY;
    const favoriteRef = doc(db, "users", user.uid, "favorites", String(item.mal_id));
    const hasFavorite = favoritesRef.current.has(String(item.mal_id));
    setFavorites((prev) => {
      const next = new Set(prev);
      if (hasFavorite) {
        next.delete(String(item.mal_id));
      } else {
        next.add(String(item.mal_id));
      }
      favoritesRef.current = next;
      return next;
    });
    favoritesOptimisticAtRef.current = Date.now();
    const cover =
      aniCovers[item.mal_id] ||
      getAniListCoverFromCache(item.mal_id) ||
      "";
    if (hasFavorite) {
      await deleteDoc(favoriteRef);
      logFavoriteActivity(user.uid, {
        action: "removed",
        mediaType: "anime",
        itemKey: String(item.mal_id),
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
    logFavoriteActivity(user.uid, {
      action: "added",
      mediaType: "anime",
      itemKey: String(item.mal_id),
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

  // useEffect(() => {
  //   obtainSeasonalAnime();
  // }, []);

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
              placeholder="Search for your next favorite..."
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
                    key={`anime-suggest-${item.mal_id}`}
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
                      navigate(`/anime/${item.mal_id}`, { state: { from: fromPath } });
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
                        <span>Anime</span>
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
            <h2>Discover anime that matches your mood</h2>
            <p>
              Explore stories, studios, and scores with a layout inspired by neon
              arcades and midnight cityscapes.
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
              <span className="pill">{filteredAnime.length} titles</span>
              {searchError && <span className="pill muted">{searchError}</span>}
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
                <div className="anime-card skeleton-card" key={`skeleton-${index}`}>
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
              {filteredAnime.map((item, index) => {
                const cover =
                  aniCovers[item.mal_id] ||
                  getAniListCoverFromCache(item.mal_id) ||
                  item?.images?.jpg?.image_url ||
                  item?.images?.webp?.image_url ||
                  "";
                const seasonLabel = isSeasonalMode
                  ? seasonLabelFromIso(item?.aired?.from) ||
                    `${seasonOptions.find((s) => s.value === seasonName)?.label || "Season"} ${seasonYear}`
                  : "";
                const key = item?.mal_id
                  ? (isSeasonalMode
                      ? `anime-${item.mal_id}-${String(item?.aired?.from || "")}-${index}`
                      : String(item.mal_id))
                  : `anime-${item?.title || "unknown"}-${index}`;
                return (
                  <AnimeCardItem
                    key={key}
                    item={item}
                    cover={cover}
                    seasonLabel={seasonLabel}
                    fromPath={fromPath}
                    isFavorite={favorites.has(String(item.mal_id))}
                    pulse={favoritePulseId === String(item.mal_id)}
                    onToggle={toggleFavorite}
                    disabled={!user}
                  />
                );
              })}
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
            fromPath={fromPath}
          ></Sidebar>
        </div>
      </div>
    </div>
  );
}

export default MainContent;

const AnimeCardItem = React.memo(function AnimeCardItem({
  item,
  cover,
  seasonLabel,
  fromPath,
  isFavorite,
  pulse,
  onToggle,
  disabled
}) {
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

  return (
    <article className="anime-card">
      <Link to={`/anime/${mal_id}`} state={{ from: fromPath }}>
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
          {seasonLabel && <span className="tag seasonal">{seasonLabel}</span>}
          {type && <span className="tag">{type}</span>}
          {source && <span className="tag">{source}</span>}
        </div>
        <Link className="card-title-link" to={`/anime/${mal_id}`} state={{ from: fromPath }}>
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
          <Link className="detail-link" to={`/anime/${mal_id}`} state={{ from: fromPath }}>
            View details
          </Link>
          <button
            className={`favorite-button ${isFavorite ? "active" : ""} ${pulse ? "pulse" : ""}`}
            type="button"
            onClick={() => onToggle(item)}
            disabled={disabled}
            title={disabled ? "Sign in to save favorites" : "Save to favorites"}
          >
            {isFavorite ? "Favorited" : "Add to favorites"}
          </button>
        </div>
      </div>
    </article>
  );
});

// source to make multiple fetch https://medium.com/@jdhawks/make-fetch-s-happen-5022fcc2ddae
