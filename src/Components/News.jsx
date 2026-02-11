import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactPaginate from "react-paginate";
import "../styles.css";

function News() {
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;
  const NEWS_WINDOW_DAYS = 14;
  const [sourceImagesEnabled, setSourceImagesEnabled] = useState(() => {
    try {
      return localStorage.getItem("news-source-images") === "1";
    } catch (err) {
      return false;
    }
  });
  const truncateByPercent = (text, percent) => {
    const raw = String(text || "").trim();
    if (!raw) return "";
    if (raw.length <= 140) return raw;
    const take = Math.max(80, Math.floor(raw.length * percent));
    const sliced = raw.slice(0, take).trimEnd();
    return sliced.endsWith("...") ? sliced : `${sliced}...`;
  };
  const expandToggle = (evt) => {
    const el = evt?.currentTarget;
    if (!el || !el.dataset) return;
    el.dataset.expanded = "1";
  };
  const debugEnabled = useMemo(() => {
    try {
      const qs = new URLSearchParams(location.search || "");
      if (qs.get("debug") === "1") return true;
      return localStorage.getItem("news-debug") === "1";
    } catch (err) {
      return false;
    }
  }, [location.search]);
  const isAnimeActive = location.pathname === "/" || location.pathname.startsWith("/seasonal/anime");
  const isMangaActive = location.pathname === "/manga" || location.pathname.startsWith("/seasonal/manga");
  const isNewsActive = location.pathname.startsWith("/news");
  const isDiscussionActive = location.pathname.startsWith("/discussion");
  const isFavoritesActive = location.pathname.startsWith("/favorites");
  const isSocialActive = isNewsActive || isDiscussionActive || isFavoritesActive;
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem("news-view-mode");
      if (stored === "grid" || stored === "list" || stored === "compact") return stored;
    } catch (err) {
      // ignore
    }
    return "grid";
  });
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [thumbs, setThumbs] = useState({});
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbServiceError, setThumbServiceError] = useState("");
  const [imgErrorUrls, setImgErrorUrls] = useState({});
  const [thumbDebug, setThumbDebug] = useState({});
  const thumbInFlightRef = useRef(new Set());
  const [contextCoversEnabled] = useState(() => {
    try {
      const raw = localStorage.getItem("news-context-covers");
      if (raw === "0") return false;
    } catch (err) {
      // ignore
    }
    return true;
  });
  const [context, setContext] = useState({});
  const [contextError, setContextError] = useState("");
  const contextInFlightRef = useRef(new Set());
  const [brokenContextCovers, setBrokenContextCovers] = useState(() => new Set());
  const [contextImgErrorUrls, setContextImgErrorUrls] = useState({});

  useEffect(() => {
    try {
      sessionStorage.setItem("news-last-path", fromPath);
    } catch (err) {
      // ignore
    }
  }, [fromPath]);

  useEffect(() => {
    try {
      localStorage.setItem("news-source-images", sourceImagesEnabled ? "1" : "0");
    } catch (err) {
      // ignore
    }
  }, [sourceImagesEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("news-context-covers", contextCoversEnabled ? "1" : "0");
    } catch (err) {
      // ignore
    }
  }, [contextCoversEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("news-view-mode", viewMode);
    } catch (err) {
      // ignore
    }
  }, [viewMode]);

  const checkSourceImagesEnabled = async () => {
    try {
      const res = await fetch("/api/ann/thumb/status");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      return Boolean(json?.enabled);
    } catch (err) {
      return false;
    }
  };

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((item) => item.categories.forEach((cat) => set.add(cat)));
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter((item) => {
      if (genreFilter !== "all" && !item.categories.includes(genreFilter)) {
        return false;
      }
      if (timeFilter !== "all") {
        const date = new Date(item.pubDate);
        const diffDays = (now - date) / (1000 * 60 * 60 * 24);
        if (timeFilter === "today" && diffDays > 1) return false;
        if (timeFilter === "week" && diffDays > 7) return false;
        if (timeFilter === "month" && diffDays > 30) return false;
      }
      if (search) {
        const term = search.toLowerCase();
        return (
          item.title.toLowerCase().includes(term) ||
          item.description.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [items, genreFilter, timeFilter, search]);

  useEffect(() => {
    setPage(0);
  }, [search, timeFilter, genreFilter, viewMode]);

  const proxiedImage = (url) => {
    const raw = String(url || "").trim();
    if (!raw) return "";
    return `/api/img?url=${encodeURIComponent(raw)}`;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        // Pull a larger window (server enforces cutoffs + caching). We paginate client-side.
        const response = await fetch(`/api/ann/news?days=${encodeURIComponent(NEWS_WINDOW_DAYS)}&limit=200`);
        if (!response.ok) {
          throw new Error("Failed to load news");
        }
        const json = await response.json();
        const next = Array.isArray(json?.items) ? json.items : [];
        setItems(next);
        try {
          sessionStorage.setItem("news-feed-cache", JSON.stringify({ ts: Date.now(), items: next }));
        } catch (err) {
          // ignore
        }
        if (next.length === 0) {
          setError("No news items available right now.");
        }
      } catch (err) {
        setError("Unable to load news right now. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [NEWS_WINDOW_DAYS]);

  const highlight = filtered[0];
  const nonHighlight = useMemo(() => filtered.slice(1), [filtered]);
  const pageSize = useMemo(() => {
    if (viewMode === "list") return 8;
    if (viewMode === "compact") return 15;
    return 12; // grid
  }, [viewMode]);

  const pageCount = useMemo(() => {
    if (nonHighlight.length === 0) return 0;
    return Math.max(1, Math.ceil(nonHighlight.length / pageSize));
  }, [nonHighlight.length, pageSize]);

  const pageItems = useMemo(() => {
    const safePage = Math.max(0, Math.min(page, Math.max(0, pageCount - 1)));
    const start = safePage * pageSize;
    return nonHighlight.slice(start, start + pageSize);
  }, [nonHighlight, page, pageCount, pageSize]);

  useEffect(() => {
    // Resolve previews only for the visible content (highlight on page 1 + current page items).
    if (!sourceImagesEnabled) return;
    const visible = [];
    if (page === 0 && highlight) visible.push(highlight);
    pageItems.forEach((it) => visible.push(it));
    if (visible.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();

    const fetchThumb = async (item) => {
      if (!item?.link || !item?.id) return;
      if (item.image) return;
      if (thumbs[item.id]) return;
      if (brokenThumbs.has(item.id)) return;
      if (thumbInFlightRef.current.has(item.id)) return;
      thumbInFlightRef.current.add(item.id);
      try {
        const response = await fetch(`/api/ann/thumb?url=${encodeURIComponent(item.link)}`, {
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404) {
            setThumbServiceError("Preview service is unavailable. Make sure `npm start` is running (client + server).");
          } else if (response.status === 403) {
            setThumbServiceError(
              "Source images are disabled on the server. Set NEWS_SOURCE_IMAGES_ENABLED=1 and restart `npm start`."
            );
            setSourceImagesEnabled(false);
          } else if (!thumbServiceError) {
            setThumbServiceError(`Preview service error (${response.status}).`);
          }
        }
        if (debugEnabled) {
          setThumbDebug((prev) => ({
            ...prev,
            [item.id]: {
              status: response.status,
              hasImage: Boolean(String(data?.image || "").trim())
            }
          }));
        }
        if (!response.ok) return;
        const url = String(data?.image || "").trim();
        if (!url) return;
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, [item.id]: url }));
      } catch (err) {
        // ignore
      } finally {
        thumbInFlightRef.current.delete(item.id);
      }
    };

    const runQueue = async (queue, concurrency, pauseMs) => {
      const workers = Array.from({ length: concurrency }).map(async () => {
        while (!cancelled && queue.length > 0) {
          const next = queue.shift();
          // eslint-disable-next-line no-await-in-loop
          await fetchThumb(next);
          if (pauseMs) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(pauseMs);
          }
        }
      });
      await Promise.all(workers);
    };

    setThumbLoading(true);
    runQueue([...visible], 3, 80).finally(() => {
      if (!cancelled) setThumbLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageItems, page, highlight, debugEnabled, sourceImagesEnabled]);

  useEffect(() => {
    if (!contextCoversEnabled) return;
    const visible = [];
    if (page === 0 && highlight) visible.push(highlight);
    pageItems.forEach((it) => visible.push(it));
    const inflight = contextInFlightRef.current;
    const missing = visible.filter(
      (it) =>
        it?.id &&
        !Object.prototype.hasOwnProperty.call(context, it.id) &&
        !inflight.has(it.id)
    );
    if (missing.length === 0) return;
    const missingIds = missing.map((it) => it.id);

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        setContextError("");
        missingIds.forEach((id) => inflight.add(id));
        const res = await fetch("/api/news/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: missing.map((it) => ({ id: it.id, title: it.title, categories: it.categories })) }),
          signal: controller.signal
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Context endpoint missing. Restart `npm start` so the server picks up the latest API routes.");
          }
          throw new Error(String(json?.error || "Context lookup failed"));
        }
        if (cancelled) return;
        const results = json?.results || {};
        const returnedIds = new Set(Object.keys(results));
        const nullMarks = {};
        missingIds.forEach((id) => {
          if (!returnedIds.has(id)) nullMarks[id] = null;
        });
        setContext((prev) => ({ ...prev, ...nullMarks, ...results }));
      } catch (err) {
        if (cancelled) return;
        setContextError(err?.message || "Context covers unavailable right now.");
      } finally {
        missingIds.forEach((id) => inflight.delete(id));
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
      missingIds.forEach((id) => inflight.delete(id));
    };
  }, [contextCoversEnabled, context, highlight, page, pageItems]);

  const hashHue = (seed) => {
    const str = String(seed || "");
    let h = 0;
    for (let i = 0; i < str.length; i += 1) {
      h = (h * 31 + str.charCodeAt(i)) % 360;
    }
    return h;
  };

  const placeholderStyle = (seed) => {
    const h1 = hashHue(seed);
    const h2 = (h1 + 28) % 360;
    return {
      backgroundImage: `linear-gradient(135deg, hsla(${h1}, 85%, 55%, 0.42), hsla(${h2}, 85%, 52%, 0.16))`
    };
  };

  const persistItem = (item) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(`news-item-${item.id}`, JSON.stringify(item));
    } catch (err) {
      // ignore storage errors
    }
  };

  const debugRows = useMemo(() => {
    return filtered.slice(0, 10).map((item) => {
      const raw = item.image || thumbs[item.id] || "";
      const proxied = raw ? proxiedImage(raw) : "";
      const dbg = thumbDebug[item.id] || null;
      const ctx = context?.[item.id] || null;
      const ctxCover = ctx?.cover || "";
      return {
        id: item.id,
        title: item.title,
        hasThumb: Boolean(raw),
        isBroken: brokenThumbs.has(item.id),
        proxied,
        errorUrl: imgErrorUrls[item.id] || "",
        thumbStatus: dbg?.status ?? null,
        thumbHasImage: dbg?.hasImage ?? null,
        ctxHasCover: Boolean(String(ctxCover || "").trim()),
        ctxBroken: brokenContextCovers.has(item.id),
        ctxCover,
        ctxErrorUrl: contextImgErrorUrls[item.id] || ""
      };
    });
  }, [filtered, thumbs, brokenThumbs, imgErrorUrls, thumbDebug, context, brokenContextCovers, contextImgErrorUrls]);

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
            <li className="nav-dropdown">
              <button type="button" className={`Small filter-button has-dropdown nav-dropdown-trigger ${isSocialActive ? "active" : ""}`}>
                Social Hub <span className="dropdown-caret" aria-hidden="true">▾</span>
              </button>
              <div className="dropdown-menu" role="menu" aria-label="Social Hub menu">
                <Link className="dropdown-item" role="menuitem" to="/discussion">Discussion</Link>
                <Link className="dropdown-item" role="menuitem" to="/news">News</Link>
                <Link className="dropdown-item" role="menuitem" to="/favorites">Favorites</Link>
                <Link className="dropdown-item" role="menuitem" to="/groups">Groups</Link>
              </div>
            </li>
          </ul>
        </div>
        <div className="right-filters">
          <div className="search-wrap">
            <input
              type="search"
              placeholder="Search news..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="layout">
        <section>
          <div className="hero news-hero">
            <h2>Japan Anime News</h2>
            <p>
              Curated headlines with optional AI summaries. Open the original source for full articles.
            </p>
          </div>

          <div className="results-bar">
            <h3>Latest Headlines</h3>
            <div className="results-controls">
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
                className={`trailer-toggle ${sourceImagesEnabled ? "on" : "off"}`}
                onClick={async () => {
                  // If the server has this feature disabled, don't let the UI "flicker" on/off.
                  if (!sourceImagesEnabled) {
                    const ok = await checkSourceImagesEnabled();
                    if (!ok) {
                      setThumbServiceError(
                        "Source images are disabled on the server. Set NEWS_SOURCE_IMAGES_ENABLED=1 and restart `npm start`."
                      );
                      setSourceImagesEnabled(false);
                      return;
                    }
                  }
                  setThumbServiceError("");
                  setSourceImagesEnabled((v) => !v);
                }}
                aria-pressed={sourceImagesEnabled}
                title={
                  sourceImagesEnabled
                    ? "Source images ON (may be restricted by publishers)."
                    : "Source images OFF (safer for monetization)."
                }
              >
                <span className="trailer-toggle-dot" aria-hidden="true"></span>
                <span className="trailer-toggle-label">Source images</span>
                <span className="trailer-toggle-state">{sourceImagesEnabled ? "ON" : "OFF"}</span>
              </button>
              <label className="genre-filter">
                <span className="genre-label">Category</span>
                <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
              <label className="genre-filter">
                <span className="genre-label">Time</span>
                <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                </select>
              </label>
            </div>
          </div>

          {loading && <p>Loading the latest news…</p>}
          {error && <p>{error}</p>}
          {thumbServiceError && !loading && !error && <p className="muted">{thumbServiceError}</p>}
          {contextCoversEnabled && contextError && !loading && !error && <p className="muted">{contextError}</p>}

          {debugEnabled && !loading && !error && (
            <div className="publish-card" style={{ marginTop: 12 }}>
              <div className="results-bar" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>News Image Debug</h3>
                <span className="pill">Dev</span>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                Filtered: <code>{filtered.length}</code> | Resolved thumbs: <code>{Object.keys(thumbs).length}</code> | Broken:{" "}
                <code>{brokenThumbs.size}</code>
              </p>
              <div className="inbox-list">
                {debugRows.map((row) => (
                  <div key={`news-debug-${row.id}`} className="inbox-row" style={{ cursor: "default" }}>
                    <div className="inbox-row-text">
                      <div className="inbox-row-title">
                        <span>{row.title}</span>
                        {row.hasThumb ? <span className="pill">thumb</span> : <span className="pill muted">none</span>}
                        {row.thumbStatus ? <span className="pill muted">thumb:{row.thumbStatus}</span> : null}
                        {row.thumbHasImage === false ? <span className="pill muted">empty</span> : null}
                        {row.isBroken ? <span className="pill pill-hot">broken</span> : null}
                        {row.ctxHasCover ? <span className="pill">ctx</span> : <span className="pill muted">ctx:none</span>}
                        {row.ctxBroken ? <span className="pill pill-hot">ctx:broken</span> : null}
                      </div>
                      {row.ctxCover ? (
                        <p className="muted" style={{ wordBreak: "break-all" }}>
                          ctx: <code>{row.ctxCover}</code>
                        </p>
                      ) : null}
                      {row.ctxErrorUrl ? (
                        <p className="muted" style={{ wordBreak: "break-all" }}>
                          ctx onError: <code>{row.ctxErrorUrl}</code>
                        </p>
                      ) : null}
                      {row.errorUrl ? (
                        <p className="muted" style={{ wordBreak: "break-all" }}>
                          onError: <code>{row.errorUrl}</code>
                        </p>
                      ) : row.proxied ? (
                        <p className="muted" style={{ wordBreak: "break-all" }}>
                          src: <code>{row.proxied}</code>
                        </p>
                      ) : (
                        <p className="muted">No image URL to load.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {page === 0 && highlight && !loading && (
            <div className="news-highlight">
              <div>
                <p className="news-source">{highlight.sourceName}</p>
                <h3>{highlight.title}</h3>
                <p>{highlight.summary || "No summary available."}</p>
                <Link
                  className="detail-link"
                  to={`/news/${encodeURIComponent(highlight.id)}`}
                  state={{
                    from: fromPath,
                    item: {
                      ...highlight,
                      displayTitle: highlight.title,
                      displayBody: highlight.summary
                    }
                  }}
                  onClick={() =>
                    persistItem({
                      ...highlight,
                      displayTitle: highlight.title,
                      displayBody: highlight.summary
                    })
                  }
                >
                  Read more
                </Link>
              </div>
              <div className="news-meta">
                {sourceImagesEnabled && (highlight.image || thumbs[highlight.id]) && !brokenThumbs.has(highlight.id) ? (
                  <img
                    className="news-highlight-image"
                    src={proxiedImage(highlight.image || thumbs[highlight.id])}
                    alt={highlight.title}
                    loading="lazy"
                    onError={() => {
                      const failing = proxiedImage(highlight.image || thumbs[highlight.id]);
                      if (process.env.NODE_ENV !== "production") {
                        console.warn("News highlight image failed:", failing);
                      }
                      setImgErrorUrls((prev) => ({ ...prev, [highlight.id]: failing }));
                      setBrokenThumbs((prev) => {
                        const next = new Set(prev);
                        next.add(highlight.id);
                        return next;
                      });
                    }}
                  />
                ) : contextCoversEnabled && context?.[highlight.id]?.cover && !brokenContextCovers.has(highlight.id) ? (
                  <img
                    className="news-highlight-image"
                    src={context[highlight.id].cover}
                    alt={highlight.title}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => {
                      const failing = String(context?.[highlight.id]?.cover || "").trim();
                      setContextImgErrorUrls((prev) => ({ ...prev, [highlight.id]: failing }));
                      setBrokenContextCovers((prev) => {
                        const next = new Set(prev);
                        next.add(highlight.id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <div
                    className="news-highlight-image news-card-image-placeholder"
                    aria-label="Preview unavailable"
                    style={placeholderStyle(highlight.id)}
                  >
                    <span className="muted">
                      {contextCoversEnabled &&
                      highlight?.id &&
                      Object.prototype.hasOwnProperty.call(context, highlight.id) &&
                      context[highlight.id] === null
                        ? "No cover match"
                        : contextCoversEnabled && brokenContextCovers.has(highlight.id)
                          ? "Cover blocked"
                        : sourceImagesEnabled
                          ? (thumbLoading ? "Loading preview..." : "Preview unavailable")
                          : "Preview unavailable"}
                    </span>
                  </div>
                )}
                <span>{highlight.pubDate ? new Date(highlight.pubDate).toLocaleString() : ""}</span>
                <span>{highlight.categories.join(", ")}</span>
              </div>
            </div>
          )}

	          <div className={`news-grid ${viewMode}`}>
              {pageItems.map((item) => (
                <article className="news-card" key={item.id}>
                  {sourceImagesEnabled && (item.image || thumbs[item.id]) && !brokenThumbs.has(item.id) ? (
                    <img
                      className="news-card-image"
                      src={proxiedImage(item.image || thumbs[item.id])}
                      alt={item.title}
                      loading="lazy"
                      onError={() => {
                        const failing = proxiedImage(item.image || thumbs[item.id]);
                        if (process.env.NODE_ENV !== "production") {
                          console.warn("News card image failed:", failing);
                        }
                        setImgErrorUrls((prev) => ({ ...prev, [item.id]: failing }));
                        setBrokenThumbs((prev) => {
                          const next = new Set(prev);
                          next.add(item.id);
                          return next;
                        });
                      }}
                    />
                  ) : contextCoversEnabled && context?.[item.id]?.cover && !brokenContextCovers.has(item.id) ? (
                    <img
                      className="news-card-image"
                      src={context[item.id].cover}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => {
                        const failing = String(context?.[item.id]?.cover || "").trim();
                        setContextImgErrorUrls((prev) => ({ ...prev, [item.id]: failing }));
                        setBrokenContextCovers((prev) => {
                          const next = new Set(prev);
                          next.add(item.id);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <div
                      className="news-card-image news-card-image-placeholder"
                      aria-label="Preview unavailable"
                      style={placeholderStyle(item.id)}
                    >
                      <span className="muted">
                        {contextCoversEnabled && Object.prototype.hasOwnProperty.call(context, item.id) && context[item.id] === null
                          ? "No cover match"
                          : contextCoversEnabled && brokenContextCovers.has(item.id)
                            ? "Cover blocked"
                          : sourceImagesEnabled
                            ? (thumbLoading ? "Loading preview..." : "Preview unavailable")
                            : "Preview unavailable"}
                      </span>
                    </div>
                  )}
                  <div className="news-card-body">
                    <div className="news-card-header">
                      <span className="news-source">{item.sourceName}</span>
                      <span className="news-date">
                        {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ""}
                      </span>
                    </div>
                    <h4>{item.title}</h4>
                    <p
                      className={viewMode === "compact" ? "news-summary summary-toggle" : ""}
                      title={viewMode === "compact" ? item.summary || "" : ""}
                      data-expanded="0"
                      onClick={viewMode === "compact" ? expandToggle : undefined}
                      onWheel={viewMode === "compact" ? expandToggle : undefined}
                      onKeyDown={
                        viewMode === "compact"
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") expandToggle(e);
                            }
                          : undefined
                      }
                      role={viewMode === "compact" ? "button" : undefined}
                      tabIndex={viewMode === "compact" ? 0 : undefined}
                      aria-label={viewMode === "compact" ? "Summary. Click to expand and scroll." : undefined}
                    >
                      {viewMode === "compact" ? (
                        <>
                          <span className="synopsis-preview">
                            {truncateByPercent(item.summary || "No summary available.", 0.25)}
                          </span>
                          <span className="synopsis-full">{item.summary || "No summary available."}</span>
                        </>
                      ) : (
                        item.summary || "No summary available."
                      )}
                    </p>
                    <div className="news-card-bottom">
                      <Link
                        className="detail-link news-readmore"
                        to={`/news/${encodeURIComponent(item.id)}`}
                        state={{
                          from: fromPath,
                          item: {
                            ...item,
                            displayTitle: item.title,
                            displayBody: item.summary
                          }
                        }}
                        onClick={() =>
                          persistItem({
                            ...item,
                            displayTitle: item.title,
                            displayBody: item.summary
                          })
                        }
                      >
                        Read more
                      </Link>
                      <div className="news-tags">
                        {item.categories.slice(0, 3).map((cat) => (
                          <span key={`${item.id}-${cat}`} className="tag">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
	              </article>
	            ))}
	          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <ReactPaginate
                previousLabel={"←"}
                nextLabel={"→"}
                breakLabel={"..."}
                pageCount={pageCount}
                marginPagesDisplayed={1}
                pageRangeDisplayed={3}
                onPageChange={(selected) => setPage(selected.selected)}
                forcePage={Math.max(0, Math.min(page, pageCount - 1))}
              />
            </div>
          )}
	        </section>

        <div className="Sidebar">
          <div className="sidebar-card">
            <h4>About the Feed</h4>
            <p>
              AniKumo shows headlines and categories, plus optional AI summaries. We do not
              republish full articles inside the app.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default News;
