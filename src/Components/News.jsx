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

const PROXY = "https://api.allorigins.win/raw?url=";
const TRANSLATE_URL =
  process.env.REACT_APP_TRANSLATE_URL || "https://libretranslate.de/translate";

const hasJapanese = (text = "") => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(text);

const parseFeed = (xmlText, sourceId, sourceName) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const items = Array.from(doc.querySelectorAll("item"));
  const entries = items.length > 0 ? items : Array.from(doc.querySelectorAll("entry"));

  return entries.map((entry) => {
    const title =
      entry.querySelector("title")?.textContent?.trim() || "Untitled";
    const linkNode = entry.querySelector("link");
    const link =
      linkNode?.getAttribute?.("href") || linkNode?.textContent?.trim() || "";
    const pubDate =
      entry.querySelector("pubDate")?.textContent ||
      entry.querySelector("updated")?.textContent ||
      entry.querySelector("published")?.textContent ||
      "";
    const description =
      entry.querySelector("description")?.textContent ||
      entry.querySelector("content")?.textContent ||
      entry.querySelector("summary")?.textContent ||
      "";
    const categories = Array.from(entry.querySelectorAll("category"))
      .map((cat) => cat.textContent?.trim())
      .filter(Boolean);

    return {
      id: `${sourceId}-${title}-${pubDate}`,
      title,
      link,
      pubDate,
      description,
      sourceId,
      sourceName,
      categories
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
        const results = await Promise.all(
          SOURCES.map(async (source) => {
            const response = await fetch(`${PROXY}${encodeURIComponent(source.url)}`);
            const xml = await response.text();
            return parseFeed(xml, source.id, source.name);
          })
        );
        const merged = results.flat();
        merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        setItems(merged);
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
          (hasJapanese(item.title) || hasJapanese(item.description)) &&
          !translations[item.id]
        );
      });

      for (const item of toTranslate) {
        try {
          const payload = {
            q: `${item.title}\n\n${item.description}`,
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
            setTranslations((prev) => ({
              ...prev,
              [item.id]: {
                title: tTitle || item.title,
                description: rest.join("\n\n") || item.description
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
                  {translations[highlight.id]?.description ||
                    highlight.description ||
                    "No summary available."}
                </p>
                {highlight.link && (
                  <a className="detail-link" href={highlight.link} target="_blank" rel="noreferrer">
                    Read full story
                  </a>
                )}
              </div>
              <div className="news-meta">
                <span>{highlight.pubDate ? new Date(highlight.pubDate).toLocaleString() : ""}</span>
                <span>{highlight.categories.join(", ")}</span>
              </div>
            </div>
          )}

          <div className="news-grid">
            {filtered.slice(1).map((item) => (
              <article className="news-card" key={item.id}>
                <div className="news-card-header">
                  <span className="news-source">{item.sourceName}</span>
                  <span className="news-date">
                    {item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ""}
                  </span>
                </div>
                <h4>{translations[item.id]?.title || item.title}</h4>
                <p>
                  {translations[item.id]?.description ||
                    item.description ||
                    "No summary available."}
                </p>
                <div className="news-tags">
                  {item.categories.slice(0, 3).map((cat) => (
                    <span key={`${item.id}-${cat}`} className="tag">
                      {cat}
                    </span>
                  ))}
                </div>
                {item.link && (
                  <a className="detail-link" href={item.link} target="_blank" rel="noreferrer">
                    Read more
                  </a>
                )}
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
