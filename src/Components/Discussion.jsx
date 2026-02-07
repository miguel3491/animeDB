import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

export function DiscussionPost({
  post,
  user,
  onDelete,
  detailLink = true,
  draft,
  onDraftChange
}) {
  const { profile } = useAuth();
  const mediaType = post.mediaType || "anime";
  const mediaId = post.mediaId || post.animeId || post.mal_id;
  const mediaTitle = post.mediaTitle || post.animeTitle || post.title || "Untitled";
  const mediaImage = post.mediaImage || post.animeImage || "";
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [draftReview, setDraftReview] = useState(draft?.review ?? post.review ?? "");
  const [draftRating, setDraftRating] = useState(draft?.rating ?? post.rating ?? "");
  const onDraftChangeRef = useRef(onDraftChange);
  const isOwner = user?.uid === post.userId;
  const storageKey = `discussion-seen-${post.id}`;

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
  };

  return (
    <article className="discussion-card">
      <div className="discussion-header">
        {mediaImage ? (
          <img className="discussion-cover" src={mediaImage} alt={mediaTitle} />
        ) : (
          <div className="discussion-cover placeholder" aria-label="Cover unavailable"></div>
        )}
        <div className="discussion-title">
          {detailLink ? (
            <Link to={`/discussion/${post.id}`} onClick={markSeen}>{mediaTitle}</Link>
          ) : (
            <Link to={mediaType === "manga" ? `/manga/${mediaId}` : `/anime/${mediaId}`}>{mediaTitle}</Link>
          )}
          <div className="discussion-meta">
            <span>
              Posted by{" "}
              {post.userId ? (
                <Link className="discussion-user-link" to={`/profile/${post.userId}`}>
                  {post.userName || "Anonymous"}
                </Link>
              ) : (
                post.userName || "Anonymous"
              )}
            </span>
            {post.rating ? <span>Rating: {post.rating}/10</span> : <span>Rating: N/A</span>}
            <span>{mediaType === "manga" ? "Manga" : "Anime"}</span>
            {unreadCount > 0 && (
              <span className="comment-badge">{unreadCount} new</span>
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
        <p className="discussion-body">{post.review || "No review text provided."}</p>
      )}
      <div className="discussion-footer">
        <span>{post.createdAt ? new Date(post.createdAt).toLocaleString() : ""}</span>
        {detailLink ? (
          <Link className="detail-link" to={`/discussion/${post.id}`}>View thread</Link>
        ) : (
          <Link
            className="detail-link"
            to={mediaType === "manga" ? `/manga/${mediaId}` : `/anime/${mediaId}`}
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
            {comments.map((comment) => (
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
                        <Link className="discussion-user-link" to={`/profile/${comment.userId}`}>
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
        <div className="comment-form">
          <input
            type="text"
            placeholder={user ? "Add a comment..." : "Sign in to comment"}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            disabled={!user}
          />
          <button type="button" onClick={submitComment} disabled={!user}>
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
