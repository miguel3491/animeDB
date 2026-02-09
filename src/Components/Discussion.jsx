import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactPaginate from "react-paginate";
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchJikanSuggestions } from "../utils/jikan";
import "../styles.css";

// Cache user profile reads so display name updates propagate while avoiding N+1 fetches.
const discussionProfileCache = new Map(); // uid -> { username, avatar }
const discussionProfileInflight = new Map(); // uid -> Promise

// Cache @handle resolution (usernames/{handle} -> uid -> users/{uid} profile).
const mentionHandleCache = new Map(); // handle -> { handle, uid, username, avatar } | null
const mentionHandleInflight = new Map(); // handle -> Promise

const fetchDiscussionProfile = async (uid) => {
  const key = String(uid || "").trim();
  if (!key) return null;
  if (discussionProfileCache.has(key)) return discussionProfileCache.get(key);
  if (discussionProfileInflight.has(key)) return discussionProfileInflight.get(key);
  const task = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", key));
      if (!snap.exists()) {
        discussionProfileCache.set(key, null);
        return null;
      }
      const data = snap.data() || {};
      const payload = {
        username: String(data.username || "").trim(),
        avatar: String(data.avatar || "").trim()
      };
      discussionProfileCache.set(key, payload);
      return payload;
    } catch (err) {
      return null;
    } finally {
      discussionProfileInflight.delete(key);
    }
  })();
  discussionProfileInflight.set(key, task);
  return task;
};

const resolveMentionHandle = async (handle) => {
  const key = String(handle || "").trim().toLowerCase();
  if (!key) return null;
  if (mentionHandleCache.has(key)) return mentionHandleCache.get(key);
  if (mentionHandleInflight.has(key)) return mentionHandleInflight.get(key);

  const task = (async () => {
    try {
      const snap = await getDoc(doc(db, "usernames", key));
      const uid = snap.exists() ? String(snap.data()?.uid || "").trim() : "";
      if (!uid) {
        mentionHandleCache.set(key, { handle: key, uid: "", username: "", avatar: "" });
        return mentionHandleCache.get(key);
      }
      const prof = await fetchDiscussionProfile(uid);
      const payload = {
        handle: key,
        uid,
        username: String(prof?.username || "").trim(),
        avatar: String(prof?.avatar || "").trim()
      };
      mentionHandleCache.set(key, payload);
      return payload;
    } catch (err) {
      mentionHandleCache.set(key, { handle: key, uid: "", username: "", avatar: "" });
      return mentionHandleCache.get(key);
    } finally {
      mentionHandleInflight.delete(key);
    }
  })();

  mentionHandleInflight.set(key, task);
  return task;
};

const extractMentionHandles = (text) => {
  const raw = String(text || "");
  const out = new Set();
  const re = /@([a-zA-Z0-9_]{3,30})/g;
  let match;
  while ((match = re.exec(raw))) {
    const handle = String(match[1] || "").trim().toLowerCase();
    if (!handle) continue;
    out.add(handle);
    if (out.size >= 5) break; // prevent mention-spam
  }
  return Array.from(out);
};

const resolveHandlesToUids = async (handles) => {
  const list = Array.isArray(handles) ? handles : [];
  const pairs = await Promise.all(
    list.map(async (handle) => {
      try {
        const snap = await getDoc(doc(db, "usernames", String(handle).toLowerCase()));
        const uid = snap.exists() ? snap.data()?.uid : "";
        return [handle, String(uid || "").trim()];
      } catch (err) {
        return [handle, ""];
      }
    })
  );
  const uids = new Set();
  pairs.forEach(([, uid]) => {
    if (uid) uids.add(uid);
  });
  return Array.from(uids);
};

export function DiscussionPost({
  post,
  user,
  onDelete,
  detailLink = true,
  spoilerBlurEnabled = true,
  commentMode = "preview",
  previewLimit = 2,
  draft,
  onDraftChange
}) {
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search || ""}`;
  const { profile } = useAuth();
  const mediaType = post.mediaType || "anime";
  const mediaId = post.mediaId || post.animeId || post.mal_id;
  const mediaTitle = post.mediaTitle || post.animeTitle || post.title || "Untitled";
  const mediaImage = post.mediaImage || post.animeImage || "";
  const [comments, setComments] = useState([]);
  const [commentPage, setCommentPage] = useState(0);
  const threadInitRef = useRef(false);
  const prevCommentsLenRef = useRef(0);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");
  const [commentBounce, setCommentBounce] = useState(false);
  const [badgePop, setBadgePop] = useState(false);
  const [mentionPreview, setMentionPreview] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftReview, setDraftReview] = useState(draft?.review ?? post.review ?? "");
  const [draftRating, setDraftRating] = useState(draft?.rating ?? post.rating ?? "");
  const [liveProfiles, setLiveProfiles] = useState({});
  const onDraftChangeRef = useRef(onDraftChange);
  const isOwner = user?.uid === post.userId;
  const spoilerHidden = Boolean(post?.spoiler) && Boolean(spoilerBlurEnabled) && !isEditing;
  const storageKey = `discussion-seen-${post.id}`;
  const lastUnreadRef = useRef(0);
  const bounceTimeoutRef = useRef(null);
  const badgeTimeoutRef = useRef(null);
  const mentionTimeoutRef = useRef(null);
  const mentionSeqRef = useRef(0);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    if (draft?.review || draft?.rating) {
      setDraftReview(draft.review ?? "");
      setDraftRating(draft.rating ?? "");
    } else {
      setDraftReview(post.review || "");
      setDraftRating(post.rating || "");
    }
  }, [post.review, post.rating, draft?.review, draft?.rating]);

  useEffect(() => {
    const handler = onDraftChangeRef.current;
    if (!handler) return;
    const key = `discussion-draft-${post.id}`;
    const payload = { review: draftReview, rating: draftRating };
    const timeout = setTimeout(() => {
      handler(payload);
      try {
        sessionStorage.setItem(key, JSON.stringify(payload));
      } catch (err) {
        // ignore
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [draftReview, draftRating, post.id]);

  useEffect(() => {
    const handler = onDraftChangeRef.current;
    if (!handler) return;
    const key = `discussion-draft-${post.id}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.review || parsed?.rating) {
          handler(parsed);
        }
      }
    } catch (err) {
      // ignore
    }
  }, [post.id]);

  useEffect(() => {
    const commentsRef = collection(db, "discussions", post.id, "comments");
    const commentsQuery = query(commentsRef, orderBy("createdAt", "asc"));
    return onSnapshot(commentsQuery, (snapshot) => {
      const data = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));
      setComments(data);
    });
  }, [post.id]);

  useEffect(() => {
    const uids = new Set();
    if (post?.userId) uids.add(post.userId);
    comments.forEach((c) => {
      if (c?.userId) uids.add(c.userId);
    });
    const list = Array.from(uids).filter(Boolean);
    if (list.length === 0) return;

    let active = true;
    (async () => {
      const next = {};
      for (const uid of list) {
        // eslint-disable-next-line no-await-in-loop
        const prof = await fetchDiscussionProfile(uid);
        if (prof) next[uid] = prof;
      }
      if (!active) return;
      setLiveProfiles((prev) => ({ ...prev, ...next }));
    })();

    return () => {
      active = false;
    };
  }, [comments, post?.userId]);

  useEffect(() => {
    threadInitRef.current = false;
    setCommentPage(0);
  }, [post.id]);

  const COMMENTS_PER_PAGE = 10;
  const isThread = commentMode === "thread";
  const totalCommentPages = Math.max(
    1,
    Math.ceil(comments.length / COMMENTS_PER_PAGE)
  );

  useEffect(() => {
    if (!isThread) return;
    const lastPage = Math.max(0, totalCommentPages - 1);
    if (!threadInitRef.current) {
      threadInitRef.current = true;
      setCommentPage(0);
      return;
    }
    if (commentPage > lastPage) {
      setCommentPage(lastPage);
    }
  }, [COMMENTS_PER_PAGE, commentPage, comments.length, isThread, totalCommentPages]);

  useEffect(() => {
    prevCommentsLenRef.current = comments.length;
  }, [comments.length]);

  useEffect(() => {
    return () => {
      if (bounceTimeoutRef.current) {
        clearTimeout(bounceTimeoutRef.current);
      }
      if (badgeTimeoutRef.current) {
        clearTimeout(badgeTimeoutRef.current);
      }
      if (mentionTimeoutRef.current) {
        clearTimeout(mentionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (mentionTimeoutRef.current) {
      clearTimeout(mentionTimeoutRef.current);
    }
    const handles = extractMentionHandles(commentText);
    if (handles.length === 0) {
      setMentionPreview([]);
      setMentionLoading(false);
      return;
    }

    const seq = (mentionSeqRef.current += 1);
    setMentionLoading(true);
    mentionTimeoutRef.current = setTimeout(async () => {
      try {
        const resolved = await Promise.all(handles.map((h) => resolveMentionHandle(h)));
        if (mentionSeqRef.current !== seq) return;
        const list = resolved
          .filter(Boolean)
          .map((item) => ({
            handle: item.handle,
            uid: item.uid,
            username: item.username,
            avatar: item.avatar
          }));
        setMentionPreview(list);
      } catch (err) {
        if (mentionSeqRef.current !== seq) return;
        setMentionPreview(handles.map((h) => ({ handle: h, uid: "", username: "", avatar: "" })));
      } finally {
        if (mentionSeqRef.current === seq) setMentionLoading(false);
      }
    }, 260);

    return () => {
      if (mentionTimeoutRef.current) {
        clearTimeout(mentionTimeoutRef.current);
      }
    };
  }, [commentText]);

  const latestCommentAt = comments.reduce((max, comment) => {
    const time = comment?.createdAt ? Date.parse(comment.createdAt) : 0;
    return Math.max(max, Number.isNaN(time) ? 0 : time);
  }, 0);

  const markSeen = () => {
    if (!isOwner || !latestCommentAt) return;
    try {
      localStorage.setItem(storageKey, String(latestCommentAt));
      window.dispatchEvent(
        new CustomEvent("discussion-seen", { detail: { postId: post.id } })
      );
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    if (!detailLink) {
      markSeen();
    }
  }, [detailLink, latestCommentAt]);

  let unreadCount = 0;
  if (isOwner && latestCommentAt) {
    let lastSeen = 0;
    try {
      lastSeen = Number(localStorage.getItem(storageKey)) || 0;
    } catch (err) {
      lastSeen = 0;
    }
    unreadCount = comments.filter((comment) => {
      if (comment.userId === post.userId) return false;
      const time = comment?.createdAt ? Date.parse(comment.createdAt) : 0;
      return !Number.isNaN(time) && time > lastSeen;
    }).length;
  }

  useEffect(() => {
    if (unreadCount > 0 && unreadCount !== lastUnreadRef.current) {
      setBadgePop(true);
      if (badgeTimeoutRef.current) {
        clearTimeout(badgeTimeoutRef.current);
      }
      badgeTimeoutRef.current = setTimeout(() => {
        setBadgePop(false);
      }, 420);
    }
    lastUnreadRef.current = unreadCount;
    return () => {
      if (badgeTimeoutRef.current) {
        clearTimeout(badgeTimeoutRef.current);
      }
    };
  }, [unreadCount]);

  const submitComment = async () => {
    if (!user) {
      setCommentError("Sign in to add a comment.");
      return;
    }
    const trimmed = commentText.trim();
    if (!trimmed) {
      setCommentError("Write a comment before posting.");
      return;
    }
    setCommentError("");
    const nowIso = new Date().toISOString();
    const commentsRef = collection(db, "discussions", post.id, "comments");
    const commentRef = doc(commentsRef);
    await setDoc(commentRef, {
      text: trimmed,
      userId: user.uid,
      userName: profile?.username || user.displayName || user.email || "Anonymous",
      userPhoto: profile?.avatar || user.photoURL || "",
      createdAt: nowIso
    });

    // Denormalized inbox event for the post author. This avoids N listeners in the header.
    if (post.userId && post.userId !== user.uid) {
      // Don't block comment creation if inbox events are locked down by rules.
      try {
        const inboxEventRef = doc(db, "users", post.userId, "inboxEvents", commentRef.id);
        await setDoc(inboxEventRef, {
          type: "comment",
          seen: false,
          clientAt: nowIso,
          createdAt: serverTimestamp(),
          toUid: post.userId,
          fromUid: user.uid,
          fromName: profile?.username || user.displayName || user.email || "Anonymous",
          fromAvatar: profile?.avatar || user.photoURL || "",
          discussionId: post.id,
          mediaType,
          mediaId: mediaId || null,
          mediaTitle,
          mediaImage
        });
      } catch (err) {
        // ignore
      }
    }

    // @mentions: notify mentioned users once per comment.
    try {
      const handles = extractMentionHandles(trimmed);
      if (handles.length > 0) {
        const fromPreview = new Map(
          (Array.isArray(mentionPreview) ? mentionPreview : []).map((m) => [m.handle, m.uid])
        );
        const previewUids = handles.map((h) => fromPreview.get(String(h).toLowerCase()) || "").filter(Boolean);
        const missing = handles.filter((h) => !(fromPreview.get(String(h).toLowerCase()) || ""));
        const resolvedUids = missing.length > 0 ? await resolveHandlesToUids(missing) : [];
        const uids = Array.from(new Set([...previewUids, ...resolvedUids]));
        const targets = uids.filter((uid) => uid && uid !== user.uid).slice(0, 5);
        if (targets.length > 0) {
          const batch = writeBatch(db);
          targets.forEach((toUid) => {
            const eventId = `mention-${commentRef.id}-${toUid}`;
            batch.set(doc(db, "users", toUid, "inboxEvents", eventId), {
              type: "mention",
              seen: false,
              clientAt: nowIso,
              createdAt: serverTimestamp(),
              toUid,
              fromUid: user.uid,
              fromName: profile?.username || user.displayName || user.email || "Anonymous",
              fromAvatar: profile?.avatar || user.photoURL || "",
              discussionId: post.id,
              commentId: commentRef.id,
              mediaType,
              mediaId: mediaId || null,
              mediaTitle,
              mediaImage,
              excerpt: trimmed.slice(0, 140)
            }, { merge: true });
          });
          await batch.commit();
        }
      }
    } catch (err) {
      // ignore mention failures
    }
    try {
      const activityRef = doc(db, "users", user.uid, "commentActivity", post.id);
      await setDoc(
        activityRef,
        {
          discussionId: post.id,
          mediaTitle,
          mediaImage,
          mediaType,
          commentedAt: new Date().toISOString()
        },
        { merge: true }
      );
    } catch (err) {
      // ignore activity failures
    }
    setCommentText("");
    setCommentBounce(true);
    if (bounceTimeoutRef.current) {
      clearTimeout(bounceTimeoutRef.current);
    }
    bounceTimeoutRef.current = setTimeout(() => {
      setCommentBounce(false);
    }, 320);

    if (isThread) {
      // Keep the thread anchored to page 1 for consistency.
      setCommentPage(0);
    }
  };

  const visibleComments = (() => {
    if (!isThread) {
      return comments.slice(0, previewLimit);
    }
    const start = commentPage * COMMENTS_PER_PAGE;
    return comments.slice(start, start + COMMENTS_PER_PAGE);
  })();

  const authorProfile = post?.userId ? liveProfiles[post.userId] : null;
  const authorName =
    authorProfile?.username ||
    post.userName ||
    "Anonymous";

  return (
    <article className={`discussion-card ${spoilerHidden ? "spoiler-hidden" : ""}`}>
      <div className="discussion-header">
        <div className="discussion-cover-wrap">
          {mediaImage ? (
            <img className="discussion-cover" src={mediaImage} alt={mediaTitle} />
          ) : (
            <div className="discussion-cover placeholder" aria-label="Cover unavailable"></div>
          )}
          {spoilerHidden && (
            <div className="spoiler-overlay" aria-label="Spoiler hidden">
              <span className="spoiler-pill">Spoiler</span>
            </div>
          )}
        </div>
        <div className="discussion-title">
          {detailLink ? (
            <Link to={`/discussion/${post.id}`} state={{ from: fromPath }} onClick={markSeen}>{mediaTitle}</Link>
          ) : (
            <Link
              to={mediaType === "manga" ? `/manga/${mediaId}` : `/anime/${mediaId}`}
              state={{ from: fromPath }}
            >
              {mediaTitle}
            </Link>
          )}
          <div className="discussion-meta">
            <span>
              Posted by{" "}
              {post.userId ? (
                <Link className="discussion-user-link" to={`/profile/${post.userId}`} state={{ from: fromPath }}>
                  {authorName}
                </Link>
              ) : (
                authorName
              )}
            </span>
            {post.rating ? <span>Rating: {post.rating}/10</span> : <span>Rating: N/A</span>}
            <span>{mediaType === "manga" ? "Manga" : "Anime"}</span>
            {post?.spoiler && <span className="spoiler-badge">Spoiler</span>}
            {unreadCount > 0 && (
              <span className={`comment-badge ${badgePop ? "pop" : ""}`}>{unreadCount} new</span>
            )}
          </div>
        </div>
        {user?.uid === post.userId && (
          <div className="discussion-actions">
            <button
              className="edit-button"
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
            >
              {isEditing ? "Cancel" : "Edit"}
            </button>
            <button className="delete-button" type="button" onClick={() => onDelete(post)}>
              Delete
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <div className="discussion-edit">
          <label>
            Review
            <textarea
              rows={4}
              value={draftReview}
              onChange={(e) => setDraftReview(e.target.value)}
            ></textarea>
          </label>
          <label>
            Rating
            <select value={draftRating} onChange={(e) => setDraftRating(e.target.value)}>
              <option value="">Unrated</option>
              {[...Array(10)].map((_, i) => (
                <option key={`edit-rate-${i + 1}`} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            className="save-button"
            type="button"
            onClick={async () => {
              await updateDoc(doc(db, "discussions", post.id), {
                review: draftReview.trim(),
                rating: draftRating,
                updatedAt: new Date().toISOString()
              });
              if (onDraftChange) {
                onDraftChange(undefined);
                try {
                  sessionStorage.removeItem(`discussion-draft-${post.id}`);
                } catch (err) {
                  // ignore
                }
              }
              setIsEditing(false);
            }}
            disabled={!draftReview.trim()}
          >
            Save changes
          </button>
        </div>
      ) : (
        <div className="discussion-body-wrap">
          <p className="discussion-body">{post.review || "No review text provided."}</p>
          {spoilerHidden && (
            <div className="spoiler-message">
              Spoiler content hidden. Toggle Spoiler Alert off to reveal.
            </div>
          )}
        </div>
      )}
      <div className="discussion-footer">
        <span>{post.createdAt ? new Date(post.createdAt).toLocaleString() : ""}</span>
        {detailLink ? (
          <Link className="detail-link" to={`/discussion/${post.id}`} state={{ from: fromPath }}>View thread</Link>
        ) : (
          <Link
            className="detail-link"
            to={mediaType === "manga" ? `/manga/${mediaId}` : `/anime/${mediaId}`}
            state={{ from: fromPath }}
          >
            View details
          </Link>
        )}
      </div>

      <div className="discussion-comments">
        <h4>Comments</h4>
        {comments.length === 0 ? (
          <p className="muted">No comments yet. Be the first to reply.</p>
        ) : (
          <div className="comment-list">
            {visibleComments.map((comment) => (
              <div className="comment-item" key={comment.id}>
                {(() => {
                  const p = comment?.userId ? liveProfiles[comment.userId] : null;
                  const name = p?.username || comment.userName || "Anonymous";
                  const avatar = p?.avatar || comment.userPhoto || "";
                  if (avatar) {
                    return <img className="comment-avatar" src={avatar} alt={name} />;
                  }
                  return <div className="comment-avatar placeholder"></div>;
                })()}
                <div>
                  <div className="comment-meta">
                    <span>
                      {comment.userId ? (
                        <Link className="discussion-user-link" to={`/profile/${comment.userId}`} state={{ from: fromPath }}>
                          {(liveProfiles[comment.userId]?.username || comment.userName || "Anonymous")}
                        </Link>
                      ) : (
                        comment.userName || "Anonymous"
                      )}
                    </span>
                    <span>{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ""}</span>
                  </div>
                  <p>{comment.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isThread && comments.length > previewLimit && (
          <div className="comment-preview-footer">
            <span className="muted">
              Showing {previewLimit} of {comments.length} comments.
            </span>
          </div>
        )}

        {isThread && totalCommentPages > 1 && (
          <div className="pagination comment-pagination">
            <ul>
              {Array.from({ length: totalCommentPages }, (_, i) => (
                <li key={`comment-page-${post.id}-${i + 1}`}>
                  <button
                    type="button"
                    onClick={() => setCommentPage(i)}
                    style={{
                      background: commentPage === i ? "rgba(255,255,255,0.2)" : "transparent"
                    }}
                  >
                    {i + 1}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="comment-form">
          <input
            type="text"
            placeholder={user ? "Add a comment..." : "Sign in to comment"}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={!user}
          />
          <button
            type="button"
            onClick={submitComment}
            disabled={!user}
            className={commentBounce ? "bounce" : ""}
          >
            Post
          </button>
        </div>
        {user && (mentionLoading || mentionPreview.length > 0) && (
          <div className="mention-preview" aria-live="polite">
            <div className="mention-preview-head">
              <span className="muted">Mentions</span>
              {mentionLoading && <span className="pill">Checking...</span>}
            </div>
            <div className="mention-chips">
              {mentionPreview.map((m) => {
                const valid = Boolean(m.uid);
                const label = valid ? (m.username || `@${m.handle}`) : "Not found";
                return (
                  <span
                    key={`mention-chip-${post.id}-${m.handle}`}
                    className={`mention-chip ${valid ? "valid" : "invalid"}`}
                    title={valid ? `Will notify @${m.handle}` : `Unknown handle: @${m.handle}`}
                  >
                    {m.avatar ? (
                      <img className="mention-chip-avatar" src={m.avatar} alt={label} loading="lazy" />
                    ) : (
                      <span className="mention-chip-avatar placeholder" aria-hidden="true"></span>
                    )}
                    <span className="mention-chip-text">@{m.handle}</span>
                    <span className="mention-chip-name">{label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {commentError && <p className="muted">{commentError}</p>}
      </div>
    </article>
  );
}

function Discussion() {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionAbortRef = useRef(null);
  const suggestionTimeoutRef = useRef(null);
  const [activeTab, setActiveTab] = useState("anime");
  const [showGuide, setShowGuide] = useState(false);
  const [postPage, setPostPage] = useState(0);
  const [spoilerBlurEnabled, setSpoilerBlurEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem("spoiler-blur-enabled");
      if (stored === null) return true;
      return stored === "1";
    } catch (err) {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("spoiler-blur-enabled", spoilerBlurEnabled ? "1" : "0");
    } catch (err) {
      // ignore
    }
  }, [spoilerBlurEnabled]);

  useEffect(() => {
    setSelectedMediaId(null);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setSuggestionsLoading(false);
    if (suggestionAbortRef.current) {
      suggestionAbortRef.current.abort();
    }
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }
  }, [activeTab]);

  useEffect(() => {
    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current);
    }
    if (suggestionAbortRef.current) {
      suggestionAbortRef.current.abort();
    }
    const q = search.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      return;
    }
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    setSuggestionsLoading(true);
    suggestionTimeoutRef.current = setTimeout(async () => {
      try {
        const items = await fetchJikanSuggestions({
          type: activeTab === "manga" ? "manga" : "anime",
          query: q,
          signal: controller.signal
        });
        setSuggestions(items);
        setSuggestionsOpen(true);
      } catch (err) {
        if (err?.name !== "AbortError") {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      } finally {
        setSuggestionsLoading(false);
      }
    }, 220);

    return () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
      controller.abort();
    };
  }, [activeTab, search]);

  useEffect(() => {
    const discussionsRef = collection(db, "discussions");
    const discussionsQuery = query(discussionsRef, orderBy("createdAt", "desc"));
    return onSnapshot(discussionsQuery, (snapshot) => {
      const data = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));
      setPosts(data);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (post) => {
    if (!user || user.uid !== post.userId) return;
    const confirmed = window.confirm("Delete this review? This cannot be undone.");
    if (!confirmed) return;
    try {
      const commentsRef = collection(db, "discussions", post.id, "comments");
      const snapshot = await getDocs(commentsRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach((docItem) => {
        batch.delete(docItem.ref);
      });
      batch.delete(doc(db, "discussions", post.id));
      await batch.commit();
    } catch (error) {
      window.alert("Unable to delete this post. Please try again.");
    }
  };

  const withType = posts.map((post) => ({
    ...post,
    mediaType: post.mediaType || "anime"
  }));
  const filteredByType = withType.filter((post) => post.mediaType === activeTab);
  const myPosts = filteredByType.filter((post) => post.userId === user?.uid);
  const filteredByOwner = filter === "mine" ? myPosts : filteredByType;
  const term = search.trim().toLowerCase();
  const visiblePosts = (() => {
    const normalizeId = (value) => {
      const v = value === null || value === undefined ? "" : String(value);
      return v.trim();
    };
    if (selectedMediaId) {
      const sel = normalizeId(selectedMediaId);
      if (!sel) return filteredByOwner;
      return filteredByOwner.filter((post) => {
        const pid = normalizeId(post.mediaId || post.animeId || post.mal_id || "");
        return pid === sel;
      });
    }
    if (!term) return filteredByOwner;
    return filteredByOwner.filter((post) =>
      (post.mediaTitle || post.animeTitle || "").toLowerCase().includes(term)
    );
  })();
  const animeCount = withType.filter((post) => post.mediaType === "anime").length;
  const mangaCount = withType.filter((post) => post.mediaType === "manga").length;

  const POSTS_PER_PAGE = 7;
  const postPageCount = Math.max(1, Math.ceil(visiblePosts.length / POSTS_PER_PAGE));
  const safePostPage = Math.max(0, Math.min(postPage, postPageCount - 1));
  const pagedPosts = visiblePosts.slice(
    safePostPage * POSTS_PER_PAGE,
    safePostPage * POSTS_PER_PAGE + POSTS_PER_PAGE
  );

  useEffect(() => {
    setPostPage(0);
  }, [activeTab, filter, selectedMediaId, search]);

  useEffect(() => {
    if (postPage > postPageCount - 1) {
      setPostPage(0);
    }
  }, [postPage, postPageCount]);

  return (
    <div className="layout">
      <section>
        <div className="hero">
          <h2>Discussion</h2>
          <p>
            Completed an anime? Publish your review and let the community discuss it.
          </p>
          <button
            type="button"
            className="detail-link"
            onClick={() => setShowGuide((prev) => !prev)}
          >
            {showGuide ? "Hide steps" : "Read more..."}
          </button>
          {showGuide && (
            <div className="discussion-guide">
              <h4>How to publish a review</h4>
              <ol>
                <li>Go to Favorites and open the anime or manga you finished.</li>
                <li>Set the status to <strong>Completed</strong>.</li>
                <li>Add your review in the Notes field and pick a rating.</li>
                <li>Click <strong>Publish review</strong>.</li>
                <li>Visit Discussion to see your post and reply to comments.</li>
              </ol>
            </div>
          )}
        </div>
        <div className="results-bar discussion-results-bar">
          <h3>Community reviews</h3>
          <div className="discussion-filter">
            <div className="search-wrap discussion-search">
              <input
                type="search"
                placeholder={activeTab === "manga" ? "Search manga reviews..." : "Search anime reviews..."}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelectedMediaId(null);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSuggestionsOpen(false);
                  }
                  if (e.key === "Enter") {
                    setSuggestionsOpen(false);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setSuggestionsOpen(false)}
                title="Search"
              >
                Search
              </button>
              {suggestionsOpen && (suggestionsLoading || suggestions.length > 0) && (
                <div className="search-suggestions" role="listbox">
                  {suggestionsLoading && (
                    <div className="muted" style={{ padding: "8px 10px" }}>
                      Loading suggestions...
                    </div>
                  )}
                  {suggestions.map((item) => (
                    <button
                      key={`discussion-suggest-${activeTab}-${item.mal_id || item.title}`}
                      type="button"
                      className="search-suggestion-item"
                      onClick={() => {
                        setSearch(item.title || "");
                        if (item?.mal_id) {
                          setSelectedMediaId(String(item.mal_id));
                        } else {
                          setSelectedMediaId(null);
                        }
                        setSuggestionsOpen(false);
                      }}
                    >
                      {item.image ? (
                        <img className="search-suggestion-thumb" src={item.image} alt={item.title} />
                      ) : (
                        <div className="search-suggestion-thumb" aria-hidden="true"></div>
                      )}
                      <div>
                        <div className="search-suggestion-title">{item.title}</div>
                        <div className="search-suggestion-meta">
                          <span>{activeTab === "manga" ? "Manga" : "Anime"}</span>
                          {item?.mal_id ? <span>#{item.mal_id}</span> : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`spoiler-toggle ${spoilerBlurEnabled ? "active" : ""}`}
              onClick={() => setSpoilerBlurEnabled((prev) => !prev)}
              title={spoilerBlurEnabled ? "Spoiler Alert is ON (spoiler posts are blurred)" : "Spoiler Alert is OFF (spoiler posts are visible)"}
            >
              Spoiler Alert: {spoilerBlurEnabled ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All posts ({filteredByType.length})
            </button>
            <button
              type="button"
              className={filter === "mine" ? "active" : ""}
              onClick={() => setFilter("mine")}
              disabled={!user}
              title={user ? "" : "Sign in to see your posts"}
            >
              My posts ({myPosts.length})
            </button>
          </div>
        </div>
        <div className="discussion-tabs">
          <button
            type="button"
            className={activeTab === "anime" ? "active" : ""}
            onClick={() => setActiveTab("anime")}
          >
            Anime ({animeCount})
          </button>
          <button
            type="button"
            className={activeTab === "manga" ? "active" : ""}
            onClick={() => setActiveTab("manga")}
          >
            Manga ({mangaCount})
          </button>
        </div>
        {loading ? (
          <p>Loading discussions...</p>
        ) : visiblePosts.length === 0 ? (
          <div className="discussion-empty">
            <p>
              {search
                ? "No reviews match that search."
                : "No reviews yet. Mark a title as completed and publish your review."}
            </p>
            <Link className="detail-link" to="/favorites">Go to favorites</Link>
          </div>
        ) : (
          <>
            <div className="discussion-grid">
              {pagedPosts.map((post) => (
                <DiscussionPost
                  key={post.id}
                  post={post}
                  user={user}
                  onDelete={handleDelete}
                  spoilerBlurEnabled={spoilerBlurEnabled}
                  draft={drafts[post.id]}
                  onDraftChange={(next) =>
                    setDrafts((prev) => ({ ...prev, [post.id]: next }))
                  }
                />
              ))}
            </div>
            {postPageCount > 1 && (
              <div className="pagination">
                <ReactPaginate
                  previousLabel={"←"}
                  nextLabel={"→"}
                  breakLabel={"..."}
                  pageCount={postPageCount}
                  marginPagesDisplayed={1}
                  pageRangeDisplayed={3}
                  onPageChange={(selected) => setPostPage(selected.selected)}
                  forcePage={safePostPage}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default Discussion;
