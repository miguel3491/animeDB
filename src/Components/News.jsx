import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import "../styles.css";

function News() {
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;
  const isAnimeActive = location.pathname === "/" || location.pathname.startsWith("/seasonal/anime");
  const isMangaActive = location.pathname === "/manga" || location.pathname.startsWith("/seasonal/manga");
  const isNewsActive = location.pathname.startsWith("/news");
  const isDiscussionActive = location.pathname.startsWith("/discussion");
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [thumbs, setThumbs] = useState({});
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
  const [thumbRequested, setThumbRequested] = useState(() => new Set());

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
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/ann/news?limit=40");
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
  }, []);

  useEffect(() => {
    if (filtered.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();

    const fetchThumb = async (item) => {
      if (!item?.link || !item?.id) return;
      if (item.image) return;
      if (thumbs[item.id]) return;
      if (brokenThumbs.has(item.id)) return;
      if (thumbRequested.has(item.id)) return;
      setThumbRequested((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      try {
        const response = await fetch(`/api/ann/thumb?url=${encodeURIComponent(item.link)}`, {
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return;
        const url = String(data?.image || "").trim();
        if (!url) return;
        if (cancelled) return;
        setThumbs((prev) => ({ ...prev, [item.id]: url }));
      } catch (err) {
        // ignore
      }
    };

    // Only resolve thumbnails for the first N visible items to avoid hammering ANN.
    const candidates = filtered.slice(0, 18);
    const concurrency = 4;
    const run = async () => {
      const queue = [...candidates];
      const workers = Array.from({ length: concurrency }).map(async () => {
        while (!cancelled && queue.length > 0) {
          const next = queue.shift();
          // eslint-disable-next-line no-await-in-loop
          await fetchThumb(next);
        }
      });
      await Promise.all(workers);
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const highlight = filtered[0];
  const persistItem = (item) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(`news-item-${item.id}`, JSON.stringify(item));
    } catch (err) {
      // ignore storage errors
    }
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

          {highlight && !loading && (
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
                    src={highlight.image || thumbs[highlight.id]}
                    alt={highlight.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => {
                      setBrokenThumbs((prev) => {
                        const next = new Set(prev);
                        next.add(highlight.id);
                        return next;
                      });
                    }}
                  />
                )}
                <span>{highlight.pubDate ? new Date(highlight.pubDate).toLocaleString() : ""}</span>
                <span>{highlight.categories.join(", ")}</span>
              </div>
            </div>
          )}

          <div className="news-grid">
            {filtered.slice(1).map((item) => (
              <article className="news-card" key={item.id}>
                {(item.image || thumbs[item.id]) && !brokenThumbs.has(item.id) ? (
                  <img
                    className="news-card-image"
                    src={item.image || thumbs[item.id]}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => {
                      setBrokenThumbs((prev) => {
                        const next = new Set(prev);
                        next.add(item.id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <div className="news-card-image news-card-image-placeholder" aria-label="Preview unavailable">
                    <span className="muted">Preview unavailable</span>
                  </div>
                )}
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
              </article>
            ))}
          </div>
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
