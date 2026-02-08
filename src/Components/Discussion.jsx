import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { addDoc, collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

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
  const [isEditing, setIsEditing] = useState(false);
  const [draftReview, setDraftReview] = useState(draft?.review ?? post.review ?? "");
  const [draftRating, setDraftRating] = useState(draft?.rating ?? post.rating ?? "");
  const onDraftChangeRef = useRef(onDraftChange);
  const isOwner = user?.uid === post.userId;
  const spoilerHidden = Boolean(post?.spoiler) && Boolean(spoilerBlurEnabled) && !isEditing;
  const storageKey = `discussion-seen-${post.id}`;
  const lastUnreadRef = useRef(0);
  const bounceTimeoutRef = useRef(null);
  const badgeTimeoutRef = useRef(null);

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
      setCommentPage(lastPage);
      return;
    }
    const prevLen = prevCommentsLenRef.current;
    const prevLastPage = Math.max(0, Math.ceil(prevLen / COMMENTS_PER_PAGE) - 1);
    if (commentPage === prevLastPage && prevLen !== comments.length) {
      setCommentPage(lastPage);
    } else if (commentPage > lastPage) {
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
    };
  }, []);

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
    const commentsRef = collection(db, "discussions", post.id, "comments");
    await addDoc(commentsRef, {
      text: trimmed,
      userId: user.uid,
      userName: profile?.username || user.displayName || user.email || "Anonymous",
      userPhoto: profile?.avatar || user.photoURL || "",
      createdAt: new Date().toISOString()
    });
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
      const nextTotal = comments.length + 1;
      const nextLastPage = Math.max(0, Math.ceil(nextTotal / COMMENTS_PER_PAGE) - 1);
      setCommentPage(nextLastPage);
    }
  };

  const visibleComments = (() => {
    if (!isThread) {
      return comments.slice(0, previewLimit);
    }
    const start = commentPage * COMMENTS_PER_PAGE;
    return comments.slice(start, start + COMMENTS_PER_PAGE);
  })();

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
                  {post.userName || "Anonymous"}
                </Link>
              ) : (
                post.userName || "Anonymous"
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
                {comment.userPhoto ? (
                  <img className="comment-avatar" src={comment.userPhoto} alt={comment.userName} />
                ) : (
                  <div className="comment-avatar placeholder"></div>
                )}
                <div>
                  <div className="comment-meta">
                    <span>
                      {comment.userId ? (
                        <Link className="discussion-user-link" to={`/profile/${comment.userId}`} state={{ from: fromPath }}>
                          {comment.userName || "Anonymous"}
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
  const [activeTab, setActiveTab] = useState("anime");
  const [showGuide, setShowGuide] = useState(false);
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
  const visiblePosts = term
    ? filteredByOwner.filter((post) =>
        (post.mediaTitle || post.animeTitle || "").toLowerCase().includes(term)
      )
    : filteredByOwner;
  const animeCount = withType.filter((post) => post.mediaType === "anime").length;
  const mangaCount = withType.filter((post) => post.mediaType === "manga").length;

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
        <div className="results-bar">
          <h3>Community reviews</h3>
          <div className="discussion-filter">
            <input
              type="search"
              placeholder="Search by anime title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
          <div className="discussion-grid">
            {visiblePosts.map((post) => (
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
        )}
      </section>
    </div>
  );
}

export default Discussion;
