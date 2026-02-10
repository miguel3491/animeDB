import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import "../styles.css";

function NewsDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const decodedId = decodeURIComponent(id || "");
  const [item, setItem] = useState(location.state?.item || null);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
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
  const [targetLang, setTargetLang] = useState("en");
  const [showTranslated, setShowTranslated] = useState(false);
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState("");
  const [related, setRelated] = useState([]);
  const summaryRequestedRef = useRef(false);
  const translationRequestedRef = useRef(false);
  const itemId = item?.id || "";

  const languageOptions = [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
    { code: "pt", label: "Portuguese" },
    { code: "ja", label: "Japanese" },
    { code: "zh-CN", label: "Mandarin" }
  ];

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
    if (!item?.id || !item?.title) return;
    let active = true;
    (async () => {
      try {
        setContextError("");
        const res = await fetch("/api/news/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: item.id, title: item.title }] })
        });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) throw new Error(String(json?.error || "Context unavailable"));
        setContext(json?.results?.[item.id] || null);
      } catch (err) {
        if (!active) return;
        setContext(null);
        setContextError("Context unavailable.");
      }
    })();
    return () => {
      active = false;
    };
  }, [item?.id, item?.title]);

  useEffect(() => {
    if (!item?.id) return;
    try {
      const cached = sessionStorage.getItem("news-feed-cache");
      if (!cached) return;
      const parsed = JSON.parse(cached);
      const feed = Array.isArray(parsed?.items) ? parsed.items : [];
      if (feed.length === 0) return;
      const mineCats = new Set(Array.isArray(item?.categories) ? item.categories : []);
      const titleTokens = String(item?.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, " ")
        .split(/\\s+/)
        .filter((t) => t.length >= 4 && !["anime", "manga", "announces", "reveals", "release", "releases"].includes(t));
      const tokenSet = new Set(titleTokens);

      const score = (it) => {
        let s = 0;
        const cats = Array.isArray(it?.categories) ? it.categories : [];
        cats.forEach((c) => {
          if (mineCats.has(c)) s += 3;
        });
        const otherTokens = String(it?.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9\\s]/g, " ")
          .split(/\\s+/)
          .filter((t) => t.length >= 4);
        otherTokens.forEach((t) => {
          if (tokenSet.has(t)) s += 1;
        });
        return s;
      };

      const candidates = feed
        .filter((it) => it && it.id && String(it.id) !== String(item.id))
        .map((it) => ({ it, s: score(it) }))
        .filter((row) => row.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((row) => row.it);

      setRelated(candidates);
    } catch (err) {
      setRelated([]);
    }
  }, [item?.categories, item?.id, item?.title]);

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
    setTargetLang("en");

    setTranslationSessionDisabled(sessionStorage.getItem("translate-disabled") === "1");
    if (sessionStorage.getItem("translate-disabled") === "1") return;
  }, [itemId]);

  useEffect(() => {
    // If the user previously disabled translation due to a missing key, auto-reenable
    // once the server reports translation is configured (avoids manual "Re-enable").
    if (!itemId) return;
    if (!translationSessionDisabled) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/translate/status");
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && json?.enabled) {
          try {
            sessionStorage.removeItem("translate-disabled");
          } catch (err) {
            // ignore
          }
          setTranslationSessionDisabled(false);
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [itemId, translationSessionDisabled]);

  useEffect(() => {
    if (!itemId) return;
    if (sessionStorage.getItem("translate-disabled") === "1") return;
    const localKey = `news-translation-${targetLang}-${itemId}`;
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
  }, [itemId, targetLang]);

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
          content: item.summary || item.description || ""
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

  const translateToTarget = async (target) => {
    if (!item) return;
    if (translationLoading) return;
    if (translationSessionDisabled) return;
    if (translationRequestedRef.current) return;

    const safeTarget = String(target || "en").trim() || "en";
    const localKey = `news-translation-${safeTarget}-${item.id}`;
    // Monetization-safe: only translate our AI summary (and headline), not publisher full text.
    const title = item.displayTitle || item.title || "";
    const summaryText = summary?.summary
      ? `Summary:\n${summary.summary}\n\nKey points:\n${(summary.keyPoints || []).map((p) => `- ${p}`).join("\n")}`
      : "";
    const content = summaryText;

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
      let statusRes;
      let statusJson = {};
      try {
        statusRes = await fetch("/api/translate/status");
        statusJson = await statusRes.json().catch(() => ({}));
      } catch (err) {
        throw new Error("Translation service is unavailable. Make sure `npm start` (client + server) is running.");
      }
      if (!statusRes?.ok) {
        if (statusRes?.status === 404) {
          throw new Error("Translation endpoints are missing on the server. Restart `npm start` to load the latest API routes.");
        }
        throw new Error("Translation service is unavailable. Please try again in a moment.");
      }
      if (!statusJson?.enabled) {
        // Only lock the UI when the server explicitly says the key is missing.
        if (statusJson?.reason === "missing-key") {
          sessionStorage.setItem("translate-disabled", "1");
          setTranslationSessionDisabled(true);
        }
        throw new Error("Translation is not configured on the server (missing Google Translate API key).");
      }

      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          target: safeTarget
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Translation endpoint not found. Restart `npm start` so the server picks up the latest changes.");
        }
        const detail = String(data?.error || "Translation unavailable.");
        if (response.status === 503 || detail.toLowerCase().includes("missing google translate api key")) {
          sessionStorage.setItem("translate-disabled", "1");
          setTranslationSessionDisabled(true);
        }
        throw new Error(detail);
      }
      setTranslation(data);
      setShowTranslated(true);
      setTargetLang(safeTarget);
      sessionStorage.setItem(localKey, JSON.stringify(data));
      try {
        localStorage.setItem(localKey, JSON.stringify(data));
      } catch (err) {
        // ignore
      }
      if (data?.usedApi) {
        setTranslationNotice(`Translated (${data.sourceLang} → ${data.targetLang}). Cached in your browser.`);
      } else {
        setTranslationNotice("No translation quota used for this request.");
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

  const translatedTitle = translation?.title || "";
  const translatedBody = translation?.content || "";
  const effectiveTitle = showTranslated && translatedTitle ? translatedTitle : displayTitle;

  const translatedLines = String(translatedBody || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const translatedBullets = translatedLines.filter((line) => line.startsWith("-"));
  const translatedTextBlocks = translatedLines.filter((line) => !line.startsWith("-"));
  const canTranslate = Boolean(summary?.summary);

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

          <div className="news-body">
            <p className="muted" style={{ marginTop: 0 }}>
              This view shows the headline and an optional AI-generated summary. For the full article, open the original source.
            </p>
            {!summary?.summary ? (
              <p className="muted">
                Generate an AI summary on the right to read a short recap here.
              </p>
            ) : showTranslated && translatedBody ? (
              <>
                {translatedTextBlocks.slice(0, 6).map((line, idx) => (
                  <p key={`news-translate-${item.id}-${idx}`}>{line}</p>
                ))}
                {translatedBullets.length > 0 && (
                  <ul className="news-points">
                    {translatedBullets.slice(0, 8).map((line, idx) => (
                      <li key={`news-translate-bullet-${item.id}-${idx}`}>{line.replace(/^-\\s*/, "")}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <p>{summary.summary}</p>
                {summary?.keyPoints?.length > 0 && (
                  <ul className="news-points">
                    {summary.keyPoints.map((point, index) => (
                      <li key={`${item.id}-point-inline-${index}`}>{point}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {(summary?.whatHappened || summary?.whyItMatters || (summary?.entities || []).length > 0) && (
            <div className="publish-card" style={{ marginTop: 16 }}>
              <div className="results-bar" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Story Snapshot</h3>
                <span className="pill">AI</span>
              </div>
              {summary?.whatHappened && (
                <p className="muted" style={{ marginTop: 0 }}>
                  <strong>What happened:</strong> {summary.whatHappened}
                </p>
              )}
              {summary?.whyItMatters && (
                <p className="muted">
                  <strong>Why it matters:</strong> {summary.whyItMatters}
                </p>
              )}
              {Array.isArray(summary?.entities) && summary.entities.length > 0 && (
                <div className="news-tags" style={{ justifyContent: "flex-start" }}>
                  {summary.entities.slice(0, 8).map((e, idx) => (
                    <span key={`entity-${item.id}-${idx}`} className="tag">
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

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
          {(context?.cover || contextError) && (
            <div className="news-summary news-summary--side">
              <div className="news-summary-head">
                <h4>Context</h4>
              </div>
              {context?.cover ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <img
                    src={context.cover}
                    alt={context?.title?.romaji || context?.title?.english || "Cover"}
                    style={{
                      width: 64,
                      height: 92,
                      borderRadius: 14,
                      objectFit: "cover",
                      border: "1px solid rgba(255,255,255,0.08)"
                    }}
                    loading="lazy"
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>
                      {context?.title?.english || context?.title?.romaji || context?.title?.native || "Related title"}
                    </div>
                    <p className="muted" style={{ marginTop: 6 }}>
                      {context.type ? String(context.type).toUpperCase() : "MEDIA"}
                      {context.format ? ` • ${String(context.format).replaceAll("_", " ")}` : ""}
                      {context.seasonYear ? ` • ${context.seasonYear}` : ""}
                    </p>
                    {context?.idMal ? (
                      <Link
                        className="detail-link"
                        to={context.type === "MANGA" ? `/manga/${context.idMal}` : `/anime/${context.idMal}`}
                        state={{ from: `${location.pathname}${location.search || ""}` }}
                      >
                        View details
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="muted">{contextError || "No related title found."}</p>
              )}
            </div>
          )}

          {related.length > 0 && (
            <div className="news-summary news-summary--side" style={{ marginTop: 14 }}>
              <div className="news-summary-head">
                <h4>Related Stories</h4>
              </div>
              <div className="inbox-list">
                {related.slice(0, 6).map((r) => (
                  <div key={`rel-${r.id}`} className="inbox-row" style={{ cursor: "default" }}>
                    <div className="inbox-row-text">
                      <div className="inbox-row-title" style={{ gap: 10 }}>
                        <span style={{ fontWeight: 700 }}>{r.title}</span>
                      </div>
                      <Link
                        className="detail-link"
                        to={`/news/${encodeURIComponent(r.id)}`}
                        state={{ from: `${location.pathname}${location.search || ""}`, item: r }}
                        onClick={() => {
                          try {
                            sessionStorage.setItem(`news-item-${r.id}`, JSON.stringify(r));
                          } catch (err) {
                            // ignore
                          }
                        }}
                      >
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

            {summary?.summary && showTranslated && translatedBody ? (
              <>
                {translatedTextBlocks.slice(0, 6).map((line, idx) => (
                  <p key={`news-ai-translate-${item.id}-${idx}`}>{line}</p>
                ))}
                {translatedBullets.length > 0 && (
                  <ul className="news-points">
                    {translatedBullets.slice(0, 8).map((line, idx) => (
                      <li key={`news-ai-translate-bullet-${item.id}-${idx}`}>{line.replace(/^-\\s*/, "")}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : summary?.summary ? (
              <>
                <p>{summary.summary}</p>
                {summary?.keyPoints?.length > 0 && (
                  <ul className="news-points">
                    {summary.keyPoints.map((point, index) => (
                      <li key={`${item.id}-point-${index}`}>{point}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {!summary?.summary && !summaryLoading && !summaryError && !summaryNotice && (
              <p className="muted">Generate a summary for this article.</p>
            )}
          </div>

          <div className="news-summary news-summary--side news-translate">
            <div className="news-summary-head">
              <h4>Translation</h4>
              <label className="genre-filter" style={{ marginLeft: "auto" }}>
                <span className="genre-label">Language</span>
                <select
                  value={targetLang}
                  onChange={(e) => {
                    setTargetLang(e.target.value);
                    setShowTranslated(false);
                    setTranslationError("");
                    setTranslationNotice("");
                    setTranslation(null);
                  }}
                  aria-label="Translation language"
                  disabled={translationLoading || translationSessionDisabled}
                >
                  {languageOptions.map((opt) => (
                    <option key={`lang-${opt.code}`} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!translation?.content && (
              <button
                type="button"
                className="favorite-button news-ai-button"
                onClick={() => translateToTarget(targetLang)}
                disabled={translationLoading || translationSessionDisabled || !canTranslate}
                title={
                  translationSessionDisabled
                    ? "Translation disabled for this session"
                    : !canTranslate
                    ? "Generate an AI summary first"
                    : "Translate"
                }
                style={{ width: "100%" }}
              >
                {translationLoading ? "Translating..." : "Translate"}
              </button>
            )}

            {translationSessionDisabled && !translation?.content && (
              <div className="news-ai-disabled">
                <p className="muted" style={{ marginTop: 0 }}>
                  Translation is currently disabled for this session (server key missing).
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
                    {languageOptions.find((opt) => opt.code === (translation?.targetLang || targetLang))?.label || "Translated"}
                  </button>
                </div>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Translation is generated on demand and cached in your browser to reduce quota usage.
                </p>
              </>
            )}

            {!translation?.content && !translationLoading && !translationError && !translationNotice && (
              <p className="muted">
                {canTranslate
                  ? "Translate the AI summary on demand (cached per language)."
                  : "Generate an AI summary first to translate it."}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default NewsDetail;
