import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import "../styles.css";

function NewsDetail() {
  const { id } = useParams();
  const location = useLocation();
  const decodedId = decodeURIComponent(id || "");
  const [item, setItem] = useState(location.state?.item || null);
  const [summary, setSummary] = useState(null);
  const [, setSummaryError] = useState("");

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
    if (!item) return;
    let cancelled = false;

    const summaryDisabled = sessionStorage.getItem("summary-disabled") === "1";
    if (summaryDisabled) {
      return undefined;
    }

    const cached = sessionStorage.getItem(`news-summary-${item.id}`);
    if (cached) {
      try {
        setSummary(JSON.parse(cached));
        return;
      } catch (err) {
        // ignore cache errors
      }
    }

    const loadSummary = async () => {
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
          if (detail.toLowerCase().includes("quota")) {
            sessionStorage.setItem("summary-disabled", "1");
            throw new Error("AI summary unavailable: API quota exceeded.");
          }
          throw new Error(detail);
        }
        if (!cancelled) {
          setSummary(data);
          sessionStorage.setItem(`news-summary-${item.id}`, JSON.stringify(data));
        }
      } catch (err) {
        if (!cancelled) {
          setSummaryError(err?.message || "Summary unavailable right now.");
        }
      }
    };

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Story unavailable</h2>
          <p>We couldn't load that story. Please return to the news list.</p>
          <Link className="detail-link" to="/news">Back to news</Link>
        </section>
      </div>
    );
  }

  const displayTitle = item.displayTitle || item.title;
  const displayBody = item.displayBody || item.content || item.summary || "No summary available.";

  return (
    <div className="layout detail-layout">
      <section className="detail-panel news-detail">
        <div className="detail-header">
          <div>
            <p className="news-source">{item.sourceName}</p>
            <h2>{displayTitle}</h2>
            {item.pubDate && (
              <p className="news-date">{new Date(item.pubDate).toLocaleString()}</p>
            )}
          </div>
          <Link className="detail-link" to="/news">Back to news</Link>
        </div>
        {item.image && (
          <img className="news-detail-image" src={item.image} alt={displayTitle} />
        )}
        <div className="news-body">
          <p>{displayBody}</p>
        </div>
        {summary && summary.summary && (
          <div className="news-summary">
            <h4>AI Summary</h4>
            <p>{summary.summary}</p>
            {summary.keyPoints?.length > 0 && (
              <ul className="news-points">
                {summary.keyPoints.map((point, index) => (
                  <li key={`${item.id}-point-${index}`}>{point}</li>
                ))}
              </ul>
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
    </div>
  );
}

export default NewsDetail;
