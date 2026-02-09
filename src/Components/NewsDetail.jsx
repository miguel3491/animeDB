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
  const [summarySessionDisabled, setSummarySessionDisabled] = useState(
    () => sessionStorage.getItem("summary-disabled") === "1"
  );
  const [translation, setTranslation] = useState(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [translationNotice, setTranslationNotice] = useState("");
  const [translationSessionDisabled, setTranslationSessionDisabled] = useState(
    () => sessionStorage.getItem("translate-disabled") === "1"
  );
  const [showTranslated, setShowTranslated] = useState(false);
  const summaryRequestedRef = useRef(false);
  const translationRequestedRef = useRef(false);
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

    setSummarySessionDisabled(sessionStorage.getItem("summary-disabled") === "1");
    if (sessionStorage.getItem("summary-disabled") === "1") return;

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

  useEffect(() => {
    if (!itemId) return;
    translationRequestedRef.current = false;
    setTranslationLoading(false);
    setTranslationError("");
    setTranslationNotice("");
    setTranslation(null);
    setShowTranslated(false);

    setTranslationSessionDisabled(sessionStorage.getItem("translate-disabled") === "1");
    if (sessionStorage.getItem("translate-disabled") === "1") return;

    const localKey = `news-translation-en-${itemId}`;
    try {
      const cached = localStorage.getItem(localKey);
      if (cached) {
        setTranslation(JSON.parse(cached));
        return;
      }
    } catch (err) {
      // ignore
    }
    const sessionCached = sessionStorage.getItem(localKey);
    if (sessionCached) {
      try {
        setTranslation(JSON.parse(sessionCached));
      } catch (err) {
        // ignore
      }
    }
  }, [itemId]);

  const generateSummary = async () => {
    if (!item) return;
    if (summaryLoading) return;

    if (summarySessionDisabled) return;

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
          setSummarySessionDisabled(true);
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

  const reenableSummary = () => {
    try {
      sessionStorage.removeItem("summary-disabled");
    } catch (err) {
      // ignore storage errors
    }
    setSummarySessionDisabled(false);
    setSummaryError("");
    setSummaryNotice("");
  };

  const reenableTranslation = () => {
    try {
      sessionStorage.removeItem("translate-disabled");
    } catch (err) {
      // ignore
    }
    setTranslationSessionDisabled(false);
    setTranslationError("");
    setTranslationNotice("");
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

  const translateToEnglish = async () => {
    if (!item) return;
    if (translationLoading) return;
    if (translationSessionDisabled) return;
    if (translationRequestedRef.current) return;

    const localKey = `news-translation-en-${item.id}`;
    // Use the best available plain-text payload to avoid translating HTML.
    const title = item.displayTitle || item.title || "";
    const content = article?.contentText || item.displayBody || item.content || item.summary || item.description || "";

    try {
      const cached = localStorage.getItem(localKey);
      if (cached) {
        setTranslation(JSON.parse(cached));
        setShowTranslated(true);
        return;
      }
    } catch (err) {
      // ignore
    }

    translationRequestedRef.current = true;
    setTranslationLoading(true);
    setTranslationError("");
    setTranslationNotice("");

    try {
      const statusRes = await fetch("/api/translate/status");
      const statusJson = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok || !statusJson?.enabled) {
        sessionStorage.setItem("translate-disabled", "1");
        setTranslationSessionDisabled(true);
        throw new Error("Translation is disabled for this session.");
      }

      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          target: "en"
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = String(data?.error || "Translation unavailable.");
        if (response.status === 503 || detail.toLowerCase().includes("missing")) {
          sessionStorage.setItem("translate-disabled", "1");
          setTranslationSessionDisabled(true);
        }
        throw new Error(detail);
      }
      setTranslation(data);
      setShowTranslated(true);
      sessionStorage.setItem(localKey, JSON.stringify(data));
      try {
        localStorage.setItem(localKey, JSON.stringify(data));
      } catch (err) {
        // ignore
      }
      if (data?.usedApi) {
        setTranslationNotice(`Translated (${data.sourceLang} → ${data.targetLang}). Cached in your browser.`);
      } else {
        setTranslationNotice("This story already looks like English. No translation quota used.");
      }
    } catch (err) {
      setTranslationError(err?.message || "Translation unavailable right now.");
    } finally {
      setTranslationLoading(false);
      translationRequestedRef.current = false;
    }
  };

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

  const translatedTitle = translation?.title || "";
  const translatedBody = translation?.content || "";
  const effectiveTitle = showTranslated && translatedTitle ? translatedTitle : displayTitle;

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
              <h2>{effectiveTitle}</h2>
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
            ) : showTranslated && translatedBody ? (
              translatedBody
                .split(/\n{2,}/)
                .map((block, idx) => (
                  <p key={`news-translate-${item.id}-${idx}`}>{block.trim()}</p>
                ))
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
                  disabled={summaryLoading || summaryUsed || summarySessionDisabled}
                  title={
                    summarySessionDisabled
                      ? "AI summary disabled for this session"
                      : summaryUsed
                        ? "Summary already generated for this article"
                        : "Generate one summary per article"
                  }
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

            {summarySessionDisabled && !summary?.summary && (
              <div className="news-ai-disabled">
                <p className="muted" style={{ marginTop: 0 }}>
                  AI summary is currently disabled for this session.
                </p>
                <button type="button" className="detail-link" onClick={reenableSummary}>
                  Re-enable
                </button>
              </div>
            )}

            {!summarySessionDisabled && summaryError && !summary?.summary && (
              <p className="publish-status error">{summaryError}</p>
            )}

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
              <p className="muted">Generate a summary for this article.</p>
            )}
          </div>

          <div className="news-summary news-summary--side news-translate">
            <div className="news-summary-head">
              <h4>Translation</h4>
              {!translation?.content && (
                <button
                  type="button"
                  className="favorite-button news-ai-button"
                  onClick={translateToEnglish}
                  disabled={translationLoading || translationSessionDisabled}
                  title={translationSessionDisabled ? "Translation disabled for this session" : "Translate to English"}
                >
                  {translationLoading ? "Translating..." : "Translate"}
                </button>
              )}
            </div>

            {translationSessionDisabled && !translation?.content && (
              <div className="news-ai-disabled">
                <p className="muted" style={{ marginTop: 0 }}>
                  Translation is currently disabled for this session.
                </p>
                <button type="button" className="detail-link" onClick={reenableTranslation}>
                  Re-enable
                </button>
              </div>
            )}

            {!translationSessionDisabled && translationError && !translation?.content && (
              <p className="publish-status error">{translationError}</p>
            )}

            {!translation?.content && !translationLoading && !translationError && translationNotice && (
              <p className="muted">{translationNotice}</p>
            )}

            {translation?.content && (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="pill muted">
                    {translation.sourceLang || "?"} → {translation.targetLang || "en"}
                  </span>
                  {translation.usedApi ? (
                    <span className="pill muted">
                      {Number(translation.chars || 0).toLocaleString()} chars
                    </span>
                  ) : (
                    <span className="pill muted">0 chars</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`detail-link ${!showTranslated ? "active" : ""}`}
                    onClick={() => setShowTranslated(false)}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    className={`detail-link ${showTranslated ? "active" : ""}`}
                    onClick={() => setShowTranslated(true)}
                  >
                    English
                  </button>
                </div>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Translation is generated on demand and cached in your browser to reduce quota usage.
                </p>
              </>
            )}

            {!translation?.content && !translationLoading && !translationError && !translationNotice && (
              <p className="muted">Translate this story to English (on demand).</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default NewsDetail;
