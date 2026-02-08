import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

function Inbox() {
  const { user } = useAuth();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;

  const [followers, setFollowers] = useState([]);
  const [followerProfiles, setFollowerProfiles] = useState({});
  const [followersSeenAt, setFollowersSeenAt] = useState(() => {
    try {
      return Number(localStorage.getItem("followers-seen")) || 0;
    } catch (err) {
      return 0;
    }
  });

  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const commentUnsubsRef = useRef(new Map());
  const commentCacheRef = useRef(new Map());

  useEffect(() => {
    if (!user?.uid) {
      setFollowers([]);
      setFollowerProfiles({});
      return;
    }

    const followersRef = collection(db, "users", user.uid, "followers");
    const q = query(followersRef, orderBy("clientAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.slice(0, 25).map((docItem) => {
          const data = docItem.data() || {};
          return {
            uid: docItem.id,
            clientAt: data.clientAt || "",
            createdAt: data.createdAt || null,
            name: data.name || "",
            avatar: data.avatar || ""
          };
        });
        setFollowers(rows);
      },
      () => {
        setFollowers([]);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    const missing = followers
      .filter((f) => !f.name || !f.avatar)
      .map((f) => f.uid)
      .filter((uid) => uid && !followerProfiles[uid]);

    if (missing.length === 0) return;

    let active = true;
    Promise.all(
      missing.slice(0, 25).map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (!snap.exists()) return [uid, null];
          const data = snap.data() || {};
          return [
            uid,
            {
              username: data.username || "User",
              avatar: data.avatar || ""
            }
          ];
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
        setFollowerProfiles((prev) => ({ ...prev, ...updates }));
      }
    });

    return () => {
      active = false;
    };
  }, [followers, followerProfiles]);

  const followerUnread = useMemo(() => {
    const seen = followersSeenAt || 0;
    return followers.filter((f) => {
      const time = f?.clientAt ? Date.parse(f.clientAt) : 0;
      return time && !Number.isNaN(time) && time > seen;
    }).length;
  }, [followers, followersSeenAt]);

  const markFollowersSeen = () => {
    const newest = followers.reduce((max, f) => {
      const time = f?.clientAt ? Date.parse(f.clientAt) : 0;
      return Math.max(max, Number.isNaN(time) ? 0 : time);
    }, 0);
    try {
      localStorage.setItem("followers-seen", String(newest || Date.now()));
    } catch (err) {
      // ignore
    }
    setFollowersSeenAt(newest || Date.now());
  };

  useEffect(() => {
    if (!user?.uid) {
      setThreads([]);
      return;
    }
    setThreadsLoading(true);

    const discussionsRef = collection(db, "discussions");
    const discussionsQuery = query(discussionsRef, where("userId", "==", user.uid));

    const unsubPosts = onSnapshot(
      discussionsQuery,
      (snapshot) => {
        const postIds = new Set();
        const postMeta = new Map();

        snapshot.docs.forEach((docItem) => {
          const postId = docItem.id;
          const data = docItem.data() || {};
          postIds.add(postId);
          postMeta.set(postId, {
            postId,
            title: data.mediaTitle || data.animeTitle || data.title || "Untitled",
            image: data.mediaImage || data.animeImage || "",
            createdAt: data.createdAt || ""
          });

          if (commentUnsubsRef.current.has(postId)) return;

          const commentsRef = collection(db, "discussions", postId, "comments");
          const commentsQuery = query(commentsRef, orderBy("createdAt", "asc"));
          const unsubComments = onSnapshot(
            commentsQuery,
            (commentSnap) => {
              const timestamps = commentSnap.docs
                .map((row) => row.data())
                .filter((comment) => comment.userId !== user.uid)
                .map((comment) => Date.parse(comment.createdAt || ""))
                .filter((time) => time && !Number.isNaN(time));

              commentCacheRef.current.set(postId, timestamps);

              let lastSeen = 0;
              try {
                lastSeen = Number(localStorage.getItem(`discussion-seen-${postId}`)) || 0;
              } catch (err) {
                lastSeen = 0;
              }

              const unread = timestamps.filter((time) => time > lastSeen).length;
              commentCacheRef.current.set(`${postId}-count`, unread);

              const rows = Array.from(postMeta.entries()).map(([id, meta]) => {
                const times = commentCacheRef.current.get(id) || [];
                const count = commentCacheRef.current.get(`${id}-count`) || 0;
                const latest = times.reduce((max, t) => Math.max(max, t || 0), 0);
                return {
                  ...meta,
                  unread: count,
                  latestCommentAt: latest
                };
              });

              rows.sort((a, b) => (b.latestCommentAt || 0) - (a.latestCommentAt || 0));
              setThreads(rows);
              setThreadsLoading(false);
            },
            () => {
              commentCacheRef.current.set(`${postId}-count`, 0);
            }
          );

          commentUnsubsRef.current.set(postId, unsubComments);
        });

        commentUnsubsRef.current.forEach((unsub, postId) => {
          if (!postIds.has(postId)) {
            unsub();
            commentUnsubsRef.current.delete(postId);
            commentCacheRef.current.delete(postId);
            commentCacheRef.current.delete(`${postId}-count`);
          }
        });

        if (snapshot.empty) {
          setThreads([]);
          setThreadsLoading(false);
        }
      },
      () => {
        setThreads([]);
        setThreadsLoading(false);
      }
    );

    return () => {
      unsubPosts();
      commentUnsubsRef.current.forEach((unsub) => unsub());
      commentUnsubsRef.current.clear();
      commentCacheRef.current.clear();
    };
  }, [user?.uid]);

  const unreadThreads = threads.filter((t) => t.unread > 0);

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
          <span className="pill">Private</span>
        </div>

        <p className="muted inbox-intro">
          Your inbox shows new comments on your posts and new followers. Counts clear when you view the thread or mark followers as seen.
        </p>

        <div className="inbox-grid">
          <div className="inbox-section">
            <div className="inbox-section-head">
              <h3>New followers</h3>
              <div className="inbox-section-actions">
                <span className={`pill ${followerUnread > 0 ? "pill-hot" : ""}`}>
                  {followerUnread > 99 ? "+99" : followerUnread}
                </span>
                <button type="button" className="detail-link" onClick={markFollowersSeen} disabled={followers.length === 0}>
                  Mark seen
                </button>
              </div>
            </div>
            {followers.length === 0 ? (
              <p className="muted">No followers yet.</p>
            ) : (
              <div className="inbox-list">
                {followers.slice(0, 10).map((f) => {
                  const time = f?.clientAt ? Date.parse(f.clientAt) : 0;
                  const isNew = time && !Number.isNaN(time) && time > followersSeenAt;
                  const profile = followerProfiles[f.uid];
                  const name = f.name || profile?.username || "User";
                  const avatar = f.avatar || profile?.avatar || "";
                  return (
                    <Link
                      key={`follower-${f.uid}`}
                      className="inbox-row"
                      to={`/profile/${f.uid}`}
                      state={{ from: fromPath }}
                    >
                      {avatar ? (
                        <img className="inbox-avatar" src={avatar} alt={name} loading="lazy" />
                      ) : (
                        <div className="inbox-avatar placeholder"></div>
                      )}
                      <div className="inbox-row-text">
                        <div className="inbox-row-title">
                          <span>{name}</span>
                          {isNew && <span className="pill pill-hot">New</span>}
                        </div>
                        <p className="muted">
                          Followed {f.clientAt ? new Date(f.clientAt).toLocaleString() : "recently"}
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
              <h3>New comments on your posts</h3>
              <span className={`pill ${unreadThreads.length > 0 ? "pill-hot" : ""}`}>
                {unreadThreads.reduce((sum, t) => sum + t.unread, 0) > 99 ? "+99" : unreadThreads.reduce((sum, t) => sum + t.unread, 0)}
              </span>
            </div>

            {threadsLoading ? (
              <p className="muted">Loading threads...</p>
            ) : unreadThreads.length === 0 ? (
              <p className="muted">No new comments.</p>
            ) : (
              <div className="inbox-list">
                {unreadThreads.slice(0, 10).map((t) => (
                  <Link
                    key={`thread-${t.postId}`}
                    className="inbox-row"
                    to={`/discussion/${t.postId}`}
                    state={{ from: fromPath }}
                  >
                    {t.image ? (
                      <img className="inbox-thumb" src={t.image} alt={t.title} loading="lazy" />
                    ) : (
                      <div className="inbox-thumb placeholder"></div>
                    )}
                    <div className="inbox-row-text">
                      <div className="inbox-row-title">
                        <span>{t.title}</span>
                        <span className="pill pill-hot">{t.unread > 99 ? "+99" : t.unread}</span>
                      </div>
                      <p className="muted">Open the thread to clear the count.</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Inbox;

