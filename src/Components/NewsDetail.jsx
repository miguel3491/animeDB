import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import "../styles.css";

function NewsDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const decodedId = decodeURIComponent(id || "");
  const [item, setItem] = useState(location.state?.item || null);
  const [article, setArticle] = useState(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [brokenImages, setBrokenImages] = useState(() => new Set());
  const [summaryNotice, setSummaryNotice] = useState("");
  const [summaryUsed, setSummaryUsed] = useState(false);
  const summaryRequestedRef = useRef(false);
  const itemId = item?.id || "";

  useEffect(() => {
    if (item || !decodedId) return;
    try {
      const stored = sessionStorage.getItem(`news-item-${decodedId}`);
      if (stored) {
        setItem(JSON.parse(stored));
      }
    } catch (err) {
      // ignore storage errors
    }
  }, [decodedId, item]);

  useEffect(() => {
    if (!itemId) return;
    // Reset per-article UI state.
    summaryRequestedRef.current = false;
    setSummaryLoading(false);
    setSummaryError("");
    setSummaryNotice("");
    setSummary(null);

    const disabled = sessionStorage.getItem("summary-disabled") === "1";
    if (disabled) {
      setSummaryNotice("AI summary is currently disabled for this session.");
      return;
    }

    // Load cached summary if available.
    const localKey = `news-summary-${itemId}`;
    const usedKey = `news-summary-used-${itemId}`;

    try {
      const used = localStorage.getItem(usedKey) === "1";
      setSummaryUsed(used);
      if (used) {
        setSummaryNotice("AI summary already generated for this article.");
      }
    } catch (err) {
      setSummaryUsed(false);
    }

    const localCached = localStorage.getItem(localKey);
    if (localCached) {
      try {
        setSummary(JSON.parse(localCached));
        return;
      } catch (err) {
        // ignore cache errors
      }
    }

    const cached = sessionStorage.getItem(localKey);
    if (cached) {
      try {
        setSummary(JSON.parse(cached));
      } catch (err) {
        // ignore cache errors
      }
    }
  }, [itemId]);

  const generateSummary = async () => {
    if (!item) return;
    if (summaryLoading) return;

    const disabled = sessionStorage.getItem("summary-disabled") === "1";
    if (disabled) {
      setSummaryNotice("AI summary is currently disabled for this session.");
      return;
    }

    const localKey = `news-summary-${item.id}`;
    const usedKey = `news-summary-used-${item.id}`;

    try {
      const used = localStorage.getItem(usedKey) === "1";
      if (used) {
        setSummaryUsed(true);
        setSummaryNotice("AI summary already generated for this article.");
        const cached = localStorage.getItem(localKey);
        if (cached) {
          setSummary(JSON.parse(cached));
        }
        return;
      }
    } catch (err) {
      // ignore storage errors
    }

    if (summaryRequestedRef.current) return;
    summaryRequestedRef.current = true;

    setSummaryLoading(true);
    setSummaryError("");
    setSummaryNotice("");

    try {
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          content: item.content || item.summary || item.description || ""
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = String(data?.detail || data?.error || "Summary unavailable.");
        if (detail.toLowerCase().includes("quota") || detail.toLowerCase().includes("missing")) {
          sessionStorage.setItem("summary-disabled", "1");
        }
        throw new Error(detail);
      }

      setSummary(data);
      sessionStorage.setItem(localKey, JSON.stringify(data));
      try {
        localStorage.setItem(localKey, JSON.stringify(data));
        localStorage.setItem(usedKey, "1");
        setSummaryUsed(true);
      } catch (err) {
        // ignore storage errors
      }
    } catch (err) {
      setSummaryError(err?.message || "Summary unavailable right now.");
    } finally {
      setSummaryLoading(false);
      summaryRequestedRef.current = false;
    }
  };

  useEffect(() => {
    if (!item?.link) return;
    let cancelled = false;
    const load = async () => {
      setArticleLoading(true);
      try {
        const response = await fetch(`/api/ann/article?url=${encodeURIComponent(item.link)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || "Article unavailable");
        }
        if (!cancelled) {
          setArticle(data);
        }
      } catch (err) {
        if (!cancelled) {
          setArticle(null);
        }
      } finally {
        if (!cancelled) {
          setArticleLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [item?.link]);

  const goBack = () => {
    const from = location.state?.from;
    if (typeof from === "string" && from.length > 0) {
      navigate(from);
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/news");
  };

  if (!item) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Story unavailable</h2>
          <p>We couldn't load that story. Please return to the news list.</p>
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
        </section>
      </div>
    );
  }

  const displayTitle = item.displayTitle || item.title;
  const displayBody = item.displayBody || item.content || item.summary || "No summary available.";
  const bodyHtml = article?.contentHtml || "";

  const heroImage = article?.image || item.image || "";
  const inlineImages = Array.isArray(article?.inlineImages) ? article.inlineImages : [];
  const galleryImages = [heroImage, ...inlineImages.map((img) => img.url)]
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, 8);
  const externalCount = Number(article?.externalImageCount || 0);

  return (
    <div className="layout detail-layout">
      <div className="news-detail-shell">
        <section className="detail-panel news-detail">
          <div className="detail-header">
            <div>
              <p className="news-source">{item.sourceName}</p>
              <h2>{displayTitle}</h2>
              {item.pubDate && <p className="news-date">{new Date(item.pubDate).toLocaleString()}</p>}
            </div>
            <button type="button" className="detail-link" onClick={goBack}>
              &#8592; Back to results
            </button>
          </div>

          {galleryImages.length > 0 && (
            <div className="news-media">
              {!brokenImages.has(heroImage) && heroImage && (
                <img
                  className="news-detail-image"
                  src={heroImage}
                  alt={displayTitle}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setBrokenImages((prev) => new Set(prev).add(heroImage));
                  }}
                />
              )}
              {brokenImages.has(heroImage) && heroImage && (
                <a className="detail-link" href={heroImage} target="_blank" rel="noreferrer">
                  Open image
                </a>
              )}
              {galleryImages.length > 1 && (
                <div className="news-media-grid">
                  {galleryImages.slice(1).map((src) => {
                    const broken = brokenImages.has(src);
                    return (
                      <a
                        key={`news-media-${src}`}
                        className="news-media-thumb"
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        title="Open image"
                      >
                        {broken ? (
                          <span className="news-media-broken">Open image</span>
                        ) : (
                          <img
                            src={src}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => {
                              setBrokenImages((prev) => new Set(prev).add(src));
                            }}
                          />
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
              {externalCount > 0 && (
                <p className="muted news-media-note">
                  Some images are hosted by third-party sites and may block embedding. Click a thumbnail to open it directly.
                </p>
              )}
            </div>
          )}

          <div className="news-body">
            {articleLoading ? (
              <p className="muted">Loading the full article...</p>
            ) : bodyHtml ? (
              <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <p>{displayBody}</p>
            )}
          </div>

          {item.categories?.length > 0 && (
            <div className="news-tags">
              {item.categories.map((cat) => (
                <span key={`${item.id}-${cat}`} className="tag">
                  {cat}
                </span>
              ))}
            </div>
          )}

          {item.link && (
            <a className="detail-link" href={item.link} target="_blank" rel="noreferrer">
              Original source
            </a>
          )}
        </section>

        <aside className="news-ai-rail">
          <div className="news-summary news-summary--side">
            <div className="news-summary-head">
              <h4>AI Summary</h4>
              {!summary?.summary && (
                <button
                  type="button"
                  className="favorite-button news-ai-button"
                  onClick={generateSummary}
                  disabled={summaryLoading || summaryUsed}
                  title={summaryUsed ? "Summary already generated for this article" : "Generate one summary per article"}
                >
                  {summaryUsed ? "Used" : summaryLoading ? "Generating..." : "Generate"}
                </button>
              )}
            </div>

            {summaryLoading && !summary?.summary && (
              <div className="news-ai-skeleton" aria-label="Generating summary">
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
              </div>
            )}

            {summaryError && !summary?.summary && <p className="publish-status error">{summaryError}</p>}

            {!summary?.summary && !summaryLoading && !summaryError && summaryNotice && (
              <p className="muted">{summaryNotice}</p>
            )}

            {summary?.summary && <p>{summary.summary}</p>}

            {summary?.keyPoints?.length > 0 && (
              <ul className="news-points">
                {summary.keyPoints.map((point, index) => (
                  <li key={`${item.id}-point-${index}`}>{point}</li>
                ))}
              </ul>
            )}

            {!summary?.summary && !summaryLoading && !summaryError && !summaryNotice && (
              <p className="muted">Generate a short summary for this story (one time per article in your browser).</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default NewsDetail;
