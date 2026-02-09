import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactPaginate from "react-paginate";
import "../styles.css";

function News() {
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;
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
  const [windowDays, setWindowDays] = useState(() => {
    try {
      const qs = new URLSearchParams(location.search || "");
      const raw = Number(qs.get("days") || "");
      if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.min(180, raw));
    } catch (err) {
      // ignore
    }
    return 14;
  });
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

  useEffect(() => {
    try {
      localStorage.setItem("news-view-mode", viewMode);
    } catch (err) {
      // ignore
    }
  }, [viewMode]);

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
  }, [search, timeFilter, genreFilter, windowDays, viewMode]);

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
        const response = await fetch(`/api/ann/news?days=${encodeURIComponent(windowDays)}&limit=200`);
        if (!response.ok) {
          throw new Error("Failed to load news");
        }
        const json = await response.json();
        const next = Array.isArray(json?.items) ? json.items : [];
        setItems(next);
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
  }, [windowDays]);

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
  }, [pageItems, page, highlight, windowDays, debugEnabled]);
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
      return {
        id: item.id,
        title: item.title,
        hasThumb: Boolean(raw),
        isBroken: brokenThumbs.has(item.id),
        proxied,
        errorUrl: imgErrorUrls[item.id] || "",
        thumbStatus: dbg?.status ?? null,
        thumbHasImage: dbg?.hasImage ?? null
      };
    });
  }, [filtered, thumbs, brokenThumbs, imgErrorUrls, thumbDebug]);

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
              Curated updates from trusted sources, translated to English when needed.
            </p>
          </div>

          <div className="results-bar">
            <h3>Latest Headlines</h3>
            <div className="results-controls">
              <span className="pill">{filtered.length} stories</span>
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
              <label className="genre-filter">
                <span className="genre-label">Window</span>
                <select
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value) || 14)}
                  aria-label="News window"
                >
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                </select>
              </label>
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
                      </div>
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
		                {(highlight.image || thumbs[highlight.id]) && !brokenThumbs.has(highlight.id) && (
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
		                )}
		                {!brokenThumbs.has(highlight.id) && !(highlight.image || thumbs[highlight.id]) && (
		                  <div className="news-highlight-image news-card-image-placeholder" aria-label="Preview unavailable">
		                    <span className="muted">{thumbLoading ? "Loading preview..." : "Preview unavailable"}</span>
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
		                {(item.image || thumbs[item.id]) && !brokenThumbs.has(item.id) ? (
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
	                ) : (
	                  <div className="news-card-image news-card-image-placeholder" aria-label="Preview unavailable">
	                    <span className="muted">{thumbLoading ? "Loading preview..." : "Preview unavailable"}</span>
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
                    <p>{item.summary || "No summary available."}</p>
                    <div className="news-tags">
                      {item.categories.slice(0, 3).map((cat) => (
                        <span key={`${item.id}-${cat}`} className="tag">
                          {cat}
                        </span>
                      ))}
                    </div>
                    <Link
                      className="detail-link"
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
              This news view aggregates anime news and translates any Japanese text to
              English automatically when possible.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default News;
