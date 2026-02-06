import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles.css";

const SOURCES = [
  {
    id: "ann",
    name: "Anime News Network",
    url: "https://www.animenewsnetwork.com/news/rss.xml"
  },
  {
    id: "otakunews",
    name: "Otaku News",
    url: "https://www.otakunews.com/rss/rss.xml"
  }
];

const RSS2JSON_URL =
  process.env.REACT_APP_RSS2JSON_URL ||
  "https://api.rss2json.com/v1/api.json?rss_url=";
const TRANSLATE_URL =
  process.env.REACT_APP_TRANSLATE_URL || "https://libretranslate.de/translate";

const hasJapanese = (text = "") => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text);

const stripHtml = (value = "") => {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body.textContent || "";
};

const extractImage = (value = "") => {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(value, "text/html");
  const img = doc.querySelector("img");
  return img?.getAttribute("src") || "";
};

const parseFeed = (jsonFeed, sourceId, sourceName) => {
  const items = Array.isArray(jsonFeed?.items) ? jsonFeed.items : [];
  return items.map((item) => {
    const title = item.title?.trim() || "Untitled";
    const link = item.link || item.url || item.guid || "";
    const pubDate = item.pubDate || item.date_published || "";
    const rawSummary = item.description || item.summary || item.content_html || item.content || "";
    const rawContent = item.content || item.content_html || item.description || "";
    const summary = stripHtml(rawSummary);
    const content = stripHtml(rawContent);
    const categories = Array.isArray(item.categories)
      ? item.categories.filter(Boolean)
      : Array.isArray(item.tags)
        ? item.tags.filter(Boolean)
        : [];
    const image =
      item.thumbnail ||
      item.enclosure?.link ||
      extractImage(item.content) ||
      extractImage(item.description) ||
      "";

    return {
      id: item.guid || `${sourceId}-${title}-${pubDate}`,
      title,
      link,
      pubDate,
      summary,
      content,
      description: summary,
      sourceId,
      sourceName,
      categories,
      image
    };
  });
};

function News() {
  const [items, setItems] = useState([]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [translations, setTranslations] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const results = await Promise.allSettled(
          SOURCES.map(async (source) => {
            const response = await fetch(`${RSS2JSON_URL}${encodeURIComponent(source.url)}`);
            if (!response.ok) {
              throw new Error(`Failed to load ${source.name}`);
            }
            const json = await response.json();
            if (json?.status && json.status !== "ok") {
              throw new Error(`Feed error for ${source.name}`);
            }
            return parseFeed(json, source.id, source.name);
          })
        );
        const merged = results
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => result.value);
        merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        setItems(merged);
        if (merged.length === 0) {
          setError("No news sources responded. Please try again in a moment.");
        }
      } catch (err) {
        setError("Unable to load news right now. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((item) => item.categories.forEach((cat) => set.add(cat)));
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter((item) => {
      if (sourceFilter !== "all" && item.sourceId !== sourceFilter) {
        return false;
      }
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
  }, [items, sourceFilter, genreFilter, timeFilter, search]);

  useEffect(() => {
    if (!translateEnabled) return;
    let cancelled = false;

    const translateBatch = async () => {
      const toTranslate = filtered.filter((item) => {
        return (
          (hasJapanese(item.title) || hasJapanese(item.summary) || hasJapanese(item.content)) &&
          !translations[item.id]
        );
      });

      for (const item of toTranslate) {
        try {
          const bodyText = item.content || item.summary;
          const payload = {
            q: `${item.title}\n\n${bodyText}`,
            source: "ja",
            target: "en",
            format: "text"
          };
          const response = await fetch(TRANSLATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await response.json();
          if (!cancelled && data?.translatedText) {
            const [tTitle, ...rest] = data.translatedText.split("\n\n");
            const translatedBody = rest.join("\n\n");
            setTranslations((prev) => ({
              ...prev,
              [item.id]: {
                title: tTitle || item.title,
                body: translatedBody || item.summary
              }
            }));
          }
        } catch (err) {
          // ignore translation failures
        }
      }
    };

    translateBatch();

    return () => {
      cancelled = true;
    };
  }, [filtered, translateEnabled, translations]);

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
            <li>
              <Link className="Small filter-button" to="/">Anime</Link>
            </li>
            <li>
              <Link className="Small filter-button" to="/manga">Manga</Link>
            </li>
            <li>
              <Link className="Small filter-button active" to="/news">News</Link>
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
                <span className="genre-label">Source</span>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                  <option value="all">All</option>
                  {SOURCES.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
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
              <label className="genre-filter">
                <span className="genre-label">Translate</span>
                <select
                  value={translateEnabled ? "on" : "off"}
                  onChange={(e) => setTranslateEnabled(e.target.value === "on")}
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
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
                <h3>{translations[highlight.id]?.title || highlight.title}</h3>
                <p>
                  {translations[highlight.id]?.body ||
                    highlight.summary ||
                    "No summary available."}
                </p>
                <Link
                  className="detail-link"
                  to={`/news/${encodeURIComponent(highlight.id)}`}
                  state={{
                    item: {
                      ...highlight,
                      displayTitle: translations[highlight.id]?.title || highlight.title,
                      displayBody: translations[highlight.id]?.body || highlight.content || highlight.summary
                    }
                  }}
                  onClick={() =>
                    persistItem({
                      ...highlight,
                      displayTitle: translations[highlight.id]?.title || highlight.title,
                      displayBody: translations[highlight.id]?.body || highlight.content || highlight.summary
                    })
                  }
                >
                  Read more
                </Link>
              </div>
              <div className="news-meta">
                {highlight.image && (
                  <img
                    className="news-highlight-image"
                    src={highlight.image}
                    alt={highlight.title}
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
                {item.image ? (
                  <img className="news-card-image" src={item.image} alt={item.title} />
                ) : null}
                <div className="news-card-header">
                  <span className="news-source">{item.sourceName}</span>
                  <span className="news-date">
                    {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ""}
                  </span>
                </div>
                <h4>{translations[item.id]?.title || item.title}</h4>
                <p>
                  {translations[item.id]?.body ||
                    item.summary ||
                    "No summary available."}
                </p>
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
                    item: {
                      ...item,
                      displayTitle: translations[item.id]?.title || item.title,
                      displayBody: translations[item.id]?.body || item.content || item.summary
                    }
                  }}
                  onClick={() =>
                    persistItem({
                      ...item,
                      displayTitle: translations[item.id]?.title || item.title,
                      displayBody: translations[item.id]?.body || item.content || item.summary
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
