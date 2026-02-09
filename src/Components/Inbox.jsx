import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function Inbox() {
  const { user } = useAuth();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState({});
  const [snapshotError, setSnapshotError] = useState("");

  useEffect(() => {
    if (!user?.uid) {
      setEvents([]);
      return;
    }

    setLoading(true);
    const ref = collection(db, "users", user.uid, "inboxEvents");
    const q = query(ref, orderBy("clientAt", "desc"), limit(100));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSnapshotError("");
        const rows = snap.docs.map((docItem) => {
          const data = docItem.data() || {};
          return {
            id: docItem.id,
            type: data.type || "unknown",
            seen: Boolean(data.seen),
            clientAt: data.clientAt || "",
            fromUid: data.fromUid || "",
            fromName: data.fromName || "",
            fromAvatar: data.fromAvatar || "",
            discussionId: data.discussionId || "",
            mediaType: data.mediaType || "",
            mediaTitle: data.mediaTitle || "",
            mediaImage: data.mediaImage || "",
            reportId: data.reportId || "",
            reportTitle: data.reportTitle || ""
          };
        });
        setEvents(rows);
        setLoading(false);
      },
      (err) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Inbox snapshot failed:", err);
        }
        setSnapshotError(err?.message || "Inbox unavailable.");
        setEvents([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const unseenCount = useMemo(() => events.filter((e) => !e.seen).length, [events]);

  const followEvents = useMemo(
    () => events.filter((e) => e.type === "follow"),
    [events]
  );
  const unseenFollows = useMemo(
    () => followEvents.filter((e) => !e.seen),
    [followEvents]
  );

  const unseenCommentThreads = useMemo(() => {
    const map = new Map();
    events.forEach((e) => {
      if (e.type !== "comment") return;
      if (e.seen) return;
      if (!e.discussionId) return;
      const existing = map.get(e.discussionId) || {
        discussionId: e.discussionId,
        title: e.mediaTitle || "Untitled",
        image: e.mediaImage || "",
        latestAt: e.clientAt || "",
        count: 0,
        ids: []
      };
      existing.count += 1;
      existing.ids.push(e.id);
      if (e.clientAt && (!existing.latestAt || e.clientAt > existing.latestAt)) {
        existing.latestAt = e.clientAt;
      }
      if (!existing.title && e.mediaTitle) existing.title = e.mediaTitle;
      if (!existing.image && e.mediaImage) existing.image = e.mediaImage;
      map.set(e.discussionId, existing);
    });
    return Array.from(map.values()).sort((a, b) => (b.latestAt || "").localeCompare(a.latestAt || ""));
  }, [events]);

  const bugEvents = useMemo(
    () => events.filter((e) => e.type === "bugReportUpdate" && !e.seen),
    [events]
  );

  const recentCommentThreads = useMemo(() => {
    const map = new Map();
    events.forEach((e) => {
      if (e.type !== "comment") return;
      if (!e.discussionId) return;
      const existing = map.get(e.discussionId) || {
        discussionId: e.discussionId,
        title: e.mediaTitle || "Untitled",
        image: e.mediaImage || "",
        latestAt: e.clientAt || "",
        unseen: 0,
        ids: []
      };
      existing.ids.push(e.id);
      if (!e.seen) existing.unseen += 1;
      if (e.clientAt && (!existing.latestAt || e.clientAt > existing.latestAt)) {
        existing.latestAt = e.clientAt;
      }
      if (!existing.title && e.mediaTitle) existing.title = e.mediaTitle;
      if (!existing.image && e.mediaImage) existing.image = e.mediaImage;
      map.set(e.discussionId, existing);
    });
    return Array.from(map.values()).sort((a, b) => (b.latestAt || "").localeCompare(a.latestAt || "")).slice(0, 10);
  }, [events]);

  useEffect(() => {
    const missing = new Set();
    events.forEach((e) => {
      if (!e.fromUid) return;
      if (profiles[e.fromUid]) return;
      if (e.fromName || e.fromAvatar) return;
      missing.add(e.fromUid);
    });
    const list = Array.from(missing).slice(0, 15);
    if (!user?.uid || list.length === 0) return;

    let active = true;
    Promise.all(
      list.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (!snap.exists()) return [uid, null];
          const data = snap.data() || {};
          return [uid, { username: data.username || "User", avatar: data.avatar || "" }];
        } catch (err) {
          return [uid, null];
        }
      })
    ).then((pairs) => {
      if (!active) return;
      const updates = {};
      pairs.forEach(([uid, value]) => {
        if (value) updates[uid] = value;
      });
      if (Object.keys(updates).length > 0) {
        setProfiles((prev) => ({ ...prev, ...updates }));
      }
    });
    return () => {
      active = false;
    };
  }, [events, profiles, user?.uid]);

  const markEventsSeen = async (ids) => {
    if (!user?.uid) return;
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (unique.length === 0) return;
    try {
      const batch = writeBatch(db);
      unique.slice(0, 200).forEach((id) => {
        batch.update(doc(db, "users", user.uid, "inboxEvents", id), {
          seen: true,
          seenAt: new Date().toISOString()
        });
      });
      await batch.commit();
    } catch (err) {
      // ignore
    }
  };

  if (!user) {
    return (
      <div className="layout">
        <section className="detail-panel inbox-panel">
          <h2>Inbox</h2>
          <p className="muted">Sign in to see your inbox.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <section className="detail-panel inbox-panel">
        <div className="results-bar">
          <h2>Inbox</h2>
          <span className={`pill ${unseenCount > 0 ? "pill-hot" : ""}`}>
            {unseenCount > 99 ? "+99" : unseenCount}
          </span>
        </div>

        <p className="muted inbox-intro">
          Inbox includes: new comments on your discussion posts, new followers, and bug report updates.
        </p>

        {loading && <p className="muted">Loading inbox...</p>}
        {snapshotError && <p className="publish-status error">{snapshotError}</p>}

        <div className="inbox-grid">
          <div className="inbox-section">
            <div className="inbox-section-head">
              <h3>New followers</h3>
              <div className="inbox-section-actions">
                <span className={`pill ${unseenFollows.length > 0 ? "pill-hot" : ""}`}>
                  {unseenFollows.length > 99 ? "+99" : unseenFollows.length}
                </span>
                <button
                  type="button"
                  className="detail-link"
                  onClick={() => markEventsSeen(unseenFollows.map((e) => e.id))}
                  disabled={unseenFollows.length === 0}
                >
                  Mark seen
                </button>
              </div>
            </div>

            {followEvents.length === 0 ? (
              <p className="muted">No followers yet.</p>
            ) : (
              <div className="inbox-list">
                {followEvents.slice(0, 10).map((e) => {
                  const name = e.fromName || profiles[e.fromUid]?.username || "User";
                  const avatar = e.fromAvatar || profiles[e.fromUid]?.avatar || "";
                  return (
                    <Link
                      key={`follow-${e.id}`}
                      className="inbox-row"
                      to={e.fromUid ? `/profile/${e.fromUid}` : "/profile"}
                      state={{ from: fromPath }}
                      onClick={() => {
                        if (!e.seen) markEventsSeen([e.id]);
                      }}
                    >
                      {avatar ? (
                        <img className="inbox-avatar" src={avatar} alt={name} loading="lazy" />
                      ) : (
                        <div className="inbox-avatar placeholder"></div>
                      )}
                      <div className="inbox-row-text">
                        <div className="inbox-row-title">
                          <span>{name}</span>
                          {!e.seen && <span className="pill pill-hot">New</span>}
                        </div>
                        <p className="muted">
                          Followed {e.clientAt ? new Date(e.clientAt).toLocaleString() : "recently"}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="inbox-section">
            <div className="inbox-section-head">
              <h3>New comments</h3>
              <span className={`pill ${unseenCommentThreads.length > 0 ? "pill-hot" : ""}`}>
                {unseenCommentThreads.reduce((sum, t) => sum + t.count, 0) > 99
                  ? "+99"
                  : unseenCommentThreads.reduce((sum, t) => sum + t.count, 0)}
              </span>
            </div>

            {unseenCommentThreads.length === 0 ? (
              <p className="muted">No new comments.</p>
            ) : (
              <div className="inbox-list">
                {unseenCommentThreads.slice(0, 10).map((t) => (
                  <Link
                    key={`thread-${t.discussionId}`}
                    className="inbox-row"
                    to={`/discussion/${t.discussionId}`}
                    state={{ from: fromPath }}
                    onClick={() => markEventsSeen(t.ids)}
                  >
                    {t.image ? (
                      <img className="inbox-thumb" src={t.image} alt={t.title} loading="lazy" />
                    ) : (
                      <div className="inbox-thumb placeholder"></div>
                    )}
                    <div className="inbox-row-text">
                      <div className="inbox-row-title">
                        <span>{t.title}</span>
                        <span className="pill pill-hot">{t.count > 99 ? "+99" : t.count}</span>
                      </div>
                      <p className="muted">Open thread to view replies.</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="inbox-section" style={{ marginTop: 18 }}>
          <div className="inbox-section-head">
            <h3>Recent comment threads</h3>
            <span className="pill">Last 10</span>
          </div>
          {recentCommentThreads.length === 0 ? (
            <p className="muted">No comment notifications yet.</p>
          ) : (
            <div className="inbox-list">
              {recentCommentThreads.map((t) => (
                <Link
                  key={`recent-thread-${t.discussionId}`}
                  className="inbox-row"
                  to={`/discussion/${t.discussionId}`}
                  state={{ from: fromPath }}
                  onClick={() => {
                    const unseenIds = events
                      .filter((e) => e.type === "comment" && e.discussionId === t.discussionId && !e.seen)
                      .map((e) => e.id);
                    if (unseenIds.length > 0) {
                      markEventsSeen(unseenIds);
                    }
                  }}
                >
                  {t.image ? (
                    <img className="inbox-thumb" src={t.image} alt={t.title} loading="lazy" />
                  ) : (
                    <div className="inbox-thumb placeholder"></div>
                  )}
                  <div className="inbox-row-text">
                    <div className="inbox-row-title">
                      <span>{t.title}</span>
                      {t.unseen > 0 ? (
                        <span className="pill pill-hot">{t.unseen > 99 ? "+99" : t.unseen}</span>
                      ) : (
                        <span className="pill muted">Seen</span>
                      )}
                    </div>
                    <p className="muted">
                      Last activity {t.latestAt ? new Date(t.latestAt).toLocaleString() : "recently"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="inbox-section" style={{ marginTop: 18 }}>
          <div className="inbox-section-head">
            <h3>Bug report updates</h3>
            <span className={`pill ${bugEvents.length > 0 ? "pill-hot" : ""}`}>
              {bugEvents.length > 99 ? "+99" : bugEvents.length}
            </span>
          </div>
          {bugEvents.length === 0 ? (
            <p className="muted">No updates yet.</p>
          ) : (
            <div className="inbox-list">
              {bugEvents.slice(0, 5).map((e) => (
                <Link
                  key={`bug-${e.id}`}
                  className="inbox-row"
                  to="/profile"
                  state={{ from: fromPath }}
                  onClick={() => markEventsSeen([e.id])}
                >
                  <div className="inbox-avatar placeholder"></div>
                  <div className="inbox-row-text">
                    <div className="inbox-row-title">
                      <span>{e.reportTitle || "Bug report updated"}</span>
                      <span className="pill pill-hot">New</span>
                    </div>
                    <p className="muted">Open profile to view details.</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Inbox;
