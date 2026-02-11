import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ReactPaginate from "react-paginate";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

const safeText = (value) => String(value || "").trim();

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const roleLabel = (role) => {
  const v = String(role || "").toLowerCase();
  if (v === "admin") return "Admin";
  if (v === "officer") return "Officer";
  return "Member";
};

function GroupThreads() {
  const { id } = useParams();
  const groupId = String(id || "").trim();
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fromPath = `${location.pathname}${location.search || ""}`;

  const [group, setGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [myMember, setMyMember] = useState(null);
  const [status, setStatus] = useState("");

  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postPage, setPostPage] = useState(0);
  const [draftPost, setDraftPost] = useState("");
  const [postImages, setPostImages] = useState([]);
  const [postStatus, setPostStatus] = useState("");
  const postFileRef = useRef(null);
  const postingRef = useRef(false);

  const [openPostId, setOpenPostId] = useState("");
  const [comments, setComments] = useState([]);
  const [pendingComments, setPendingComments] = useState([]);
  const [commentPage, setCommentPage] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [commentStatus, setCommentStatus] = useState("");
  const commentingRef = useRef(false);

  const [likedMap, setLikedMap] = useState({});
  const [likeBurstId, setLikeBurstId] = useState("");
  const likeBurstTimeoutRef = useRef(null);

  useEffect(() => {
    if (!groupId) return;
    setGroupLoading(true);
    const ref = doc(db, "groups", groupId);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setGroup(null);
          setGroupLoading(false);
          return;
        }
        setGroup({ id: snap.id, ...(snap.data() || {}) });
        setGroupLoading(false);
      },
      () => {
        setGroup(null);
        setGroupLoading(false);
      }
    );
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !user?.uid) {
      setMyMember(null);
      return;
    }
    const ref = doc(db, "groups", groupId, "members", user.uid);
    return onSnapshot(
      ref,
      (snap) => setMyMember(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setMyMember(null)
    );
  }, [groupId, user?.uid]);

  const myRole = String(myMember?.role || "").toLowerCase();
  const isAdmin = myRole === "admin" || (user?.uid && group?.ownerId === user.uid);
  const isOfficer = myRole === "officer";
  const canManageMembers = Boolean(isAdmin || isOfficer);
  const isOwner = Boolean(user?.uid && group?.ownerId && String(group.ownerId) === String(user.uid));
  const commentApprovalEnabled = Boolean(group?.commentApprovalEnabled);
  const canPostApprovedComment = !commentApprovalEnabled || canManageMembers;

  const title = group?.name || "Group";
  const accent = group?.accent || "#7afcff";
  const style = group?.nameStyle || "neon";
  const memberCount = Number.isFinite(Number(group?.memberCount)) ? Number(group.memberCount) : null;

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
    navigate(`/groups/${groupId}`);
  };

  const joinGroup = async () => {
    if (!user?.uid || !groupId) return;
    if (myMember) return;
    const nowIso = new Date().toISOString();
    try {
      setStatus("");
      const memberRef = doc(db, "groups", groupId, "members", user.uid);
      const userGroupRef = doc(db, "users", user.uid, "groups", groupId);
      const publicGroupRef = doc(db, "users", user.uid, "publicGroups", groupId);
      const batch = writeBatch(db);
      batch.set(memberRef, {
        uid: user.uid,
        role: "member",
        joinedAt: nowIso,
        createdAt: serverTimestamp(),
        username: profile?.username || user.displayName || user.email || "User",
        avatar: profile?.avatar || user.photoURL || ""
      });
      batch.set(
        userGroupRef,
        {
          groupId,
          role: "member",
          joinedAt: nowIso,
          groupName: group?.name || "Group",
          groupAvatar: group?.avatar || "",
          groupAccent: group?.accent || "#7afcff",
          nameStyle: group?.nameStyle || "neon"
        },
        { merge: true }
      );
      if (group?.isPublic === true) {
        batch.set(publicGroupRef, { groupId, joinedAt: nowIso }, { merge: true });
      }
      await batch.commit();
      setStatus("Joined.");
    } catch (err) {
      setStatus(err?.message || "Unable to join. Check Firestore permissions.");
    }
  };

  const leaveGroup = async () => {
    if (!user?.uid || !groupId) return;
    if (!myMember) return;
    if (isOwner) {
      setStatus("Group owners cannot leave. Use Disband to delete the group.");
      return;
    }
    const confirmed = window.confirm("Leave this group?");
    if (!confirmed) return;
    try {
      setStatus("");
      const memberRef = doc(db, "groups", groupId, "members", user.uid);
      const userGroupRef = doc(db, "users", user.uid, "groups", groupId);
      const publicGroupRef = doc(db, "users", user.uid, "publicGroups", groupId);
      const batch = writeBatch(db);
      batch.delete(memberRef);
      batch.delete(userGroupRef);
      batch.delete(publicGroupRef);
      await batch.commit();
      setStatus("Left group.");
      setOpenPostId("");
      setPosts([]);
      setLikedMap({});
    } catch (err) {
      setStatus(err?.message || "Unable to leave.");
    }
  };

  const disbandGroup = async () => {
    if (!user?.uid || !groupId) return;
    if (!isOwner) {
      setStatus("Only the group owner can disband this group.");
      return;
    }
    const confirmed = window.confirm("Disband this group? This deletes the group for everyone.");
    if (!confirmed) return;
    try {
      setStatus("Disbanding...");
      const batch = writeBatch(db);
      batch.delete(doc(db, "groups", groupId));
      batch.delete(doc(db, "users", user.uid, "groups", groupId));
      batch.delete(doc(db, "users", user.uid, "publicGroups", groupId));
      batch.delete(doc(db, "users", user.uid, "pinnedGroups", groupId));
      await batch.commit();
      navigate("/groups", { state: { from: fromPath } });
    } catch (err) {
      setStatus(err?.message || "Unable to disband group.");
    }
  };

  useEffect(() => {
    setPostPage(0);
  }, [groupId, posts.length]);

  useEffect(() => {
    if (!groupId || !user?.uid || !myMember) {
      setPosts([]);
      setPostsLoading(false);
      return;
    }
    setPostsLoading(true);
    const ref = collection(db, "groups", groupId, "posts");
    const q = query(ref, orderBy("createdAt", "desc"), limit(60));
    return onSnapshot(
      q,
      (snap) => {
        setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPostsLoading(false);
      },
      () => {
        setPosts([]);
        setPostsLoading(false);
      }
    );
  }, [groupId, myMember, user?.uid]);

  const POSTS_PER_PAGE = 8;
  const postPageCount = useMemo(() => {
    if (posts.length === 0) return 0;
    return Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  }, [posts.length]);
  const postPageItems = useMemo(() => {
    if (posts.length === 0) return [];
    const safe = Math.max(0, Math.min(postPage, Math.max(0, postPageCount - 1)));
    const start = safe * POSTS_PER_PAGE;
    return posts.slice(start, start + POSTS_PER_PAGE);
  }, [postPage, postPageCount, posts]);

  useEffect(() => {
    if (!user?.uid || !groupId || !myMember) {
      setLikedMap({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      const next = {};
      await Promise.all(
        postPageItems.map(async (p) => {
          const pid = String(p?.id || "");
          if (!pid) return;
          try {
            const snap = await getDoc(doc(db, "groups", groupId, "posts", pid, "likes", user.uid));
            next[pid] = snap.exists();
          } catch (err) {
            next[pid] = false;
          }
        })
      );
      if (!cancelled) setLikedMap((prev) => ({ ...prev, ...next }));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId, myMember, postPageItems, user?.uid]);

  useEffect(() => {
    if (!groupId || !user?.uid || !myMember || !openPostId) {
      setComments([]);
      setPendingComments([]);
      return;
    }
    const commentsRef = collection(db, "groups", groupId, "posts", openPostId, "comments");
    const cq = query(commentsRef, orderBy("createdAt", "asc"), limit(80));
    const unsubApproved = onSnapshot(
      cq,
      (snap) => setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setComments([])
    );

    let unsubPending = null;
    if (commentApprovalEnabled && canManageMembers) {
      const pendingRef = collection(db, "groups", groupId, "posts", openPostId, "pendingComments");
      const pq = query(pendingRef, orderBy("createdAt", "asc"), limit(80));
      unsubPending = onSnapshot(
        pq,
        (snap) => setPendingComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setPendingComments([])
      );
    } else {
      setPendingComments([]);
    }
    return () => {
      unsubApproved();
      if (unsubPending) unsubPending();
    };
  }, [canManageMembers, commentApprovalEnabled, groupId, myMember, openPostId, user?.uid]);

  useEffect(() => {
    setCommentPage(0);
  }, [openPostId, comments.length]);

  const COMMENTS_PER_PAGE = 10;
  const commentPageCount = useMemo(() => {
    if (comments.length === 0) return 0;
    return Math.max(1, Math.ceil(comments.length / COMMENTS_PER_PAGE));
  }, [comments.length]);
  const commentPageItems = useMemo(() => {
    if (comments.length === 0) return [];
    const safe = Math.max(0, Math.min(commentPage, Math.max(0, commentPageCount - 1)));
    const start = safe * COMMENTS_PER_PAGE;
    return comments.slice(start, start + COMMENTS_PER_PAGE);
  }, [commentPage, commentPageCount, comments]);

  const onPickPostImages = async (files) => {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length === 0) return;
    const MAX_IMAGES = 3;
    const MAX_BYTES = 350 * 1024;
    const remaining = Math.max(0, MAX_IMAGES - postImages.length);
    const slice = list.slice(0, remaining);
    const tooBig = slice.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setPostStatus(`Image too large. Keep each image under ${Math.round(MAX_BYTES / 1024)}KB.`);
      return;
    }
    try {
      const urls = await Promise.all(slice.map((f) => readFileAsDataUrl(f)));
      setPostImages((prev) => [...prev, ...urls.filter(Boolean).map((u) => String(u))].slice(0, MAX_IMAGES));
      setPostStatus("");
    } catch (err) {
      setPostStatus("Unable to read image.");
    }
  };

  const createPost = async () => {
    if (!user?.uid || !myMember) {
      setPostStatus("Join this group to post.");
      return;
    }
    if (postingRef.current) return;
    const body = safeText(draftPost);
    if (body.length < 3 && postImages.length === 0) {
      setPostStatus("Write something or attach an image.");
      return;
    }
    if (body.length > 1400) {
      setPostStatus("Post is too long (max 1400 characters).");
      return;
    }
    postingRef.current = true;
    setPostStatus("Posting...");
    const nowIso = new Date().toISOString();
    try {
      const postRef = doc(collection(db, "groups", groupId, "posts"));
      await setDoc(postRef, {
        userId: user.uid,
        username: profile?.username || user.displayName || user.email || "User",
        avatar: profile?.avatar || user.photoURL || "",
        body,
        images: postImages.slice(0, 3),
        likeCount: 0,
        createdAt: nowIso,
        createdAtTs: serverTimestamp(),
        updatedAt: nowIso,
        updatedAtTs: serverTimestamp()
      });
      setDraftPost("");
      setPostImages([]);
      setPostStatus("Posted.");
      setOpenPostId(postRef.id);
    } catch (err) {
      setPostStatus(err?.message || "Unable to post.");
    } finally {
      postingRef.current = false;
      setTimeout(() => setPostStatus(""), 1200);
    }
  };

  const deletePost = async (postId) => {
    if (!groupId || !postId) return;
    try {
      await deleteDoc(doc(db, "groups", groupId, "posts", postId));
      if (openPostId === postId) setOpenPostId("");
    } catch (err) {
      // ignore
    }
  };

  const postComment = async () => {
    if (!user?.uid || !myMember || !openPostId) {
      setCommentStatus("Join this group to comment.");
      return;
    }
    if (commentingRef.current) return;
    const body = safeText(draftComment);
    if (body.length < 1) return;
    if (body.length > 900) {
      setCommentStatus("Comment is too long (max 900 characters).");
      return;
    }
    commentingRef.current = true;
    setCommentStatus(commentApprovalEnabled && !canManageMembers ? "Sending for approval..." : "Posting...");
    const nowIso = new Date().toISOString();
    try {
      if (canPostApprovedComment) {
        const ref = doc(collection(db, "groups", groupId, "posts", openPostId, "comments"));
        await setDoc(ref, {
          userId: user.uid,
          username: profile?.username || user.displayName || user.email || "User",
          avatar: profile?.avatar || user.photoURL || "",
          body,
          createdAt: nowIso,
          createdAtTs: serverTimestamp()
        });
        setDraftComment("");
        setCommentStatus("Posted.");
      } else {
        const ref = doc(collection(db, "groups", groupId, "posts", openPostId, "pendingComments"));
        await setDoc(ref, {
          userId: user.uid,
          username: profile?.username || user.displayName || user.email || "User",
          avatar: profile?.avatar || user.photoURL || "",
          body,
          createdAt: nowIso,
          createdAtTs: serverTimestamp()
        });
        setDraftComment("");
        setCommentStatus("Sent for approval by an officer/admin.");
      }
    } catch (err) {
      setCommentStatus(err?.message || "Unable to comment.");
    } finally {
      commentingRef.current = false;
      setTimeout(() => setCommentStatus(""), 1600);
    }
  };

  const approvePendingComment = async (c) => {
    if (!canManageMembers || !commentApprovalEnabled || !groupId || !openPostId) return;
    const cid = String(c?.id || "").trim();
    if (!cid) return;
    try {
      const nowIso = new Date().toISOString();
      const approvedRef = doc(collection(db, "groups", groupId, "posts", openPostId, "comments"));
      const pendingRef = doc(db, "groups", groupId, "posts", openPostId, "pendingComments", cid);
      const batch = writeBatch(db);
      batch.set(approvedRef, {
        userId: c.userId,
        username: c.username || "User",
        avatar: c.avatar || "",
        body: c.body || "",
        createdAt: c.createdAt || nowIso,
        createdAtTs: c.createdAtTs || serverTimestamp(),
        approvedAt: nowIso,
        approvedBy: user?.uid || ""
      });
      batch.delete(pendingRef);
      await batch.commit();
    } catch (err) {
      // ignore
    }
  };

  const rejectPendingComment = async (c) => {
    if (!canManageMembers || !groupId || !openPostId) return;
    const cid = String(c?.id || "").trim();
    if (!cid) return;
    try {
      await deleteDoc(doc(db, "groups", groupId, "posts", openPostId, "pendingComments", cid));
    } catch (err) {
      // ignore
    }
  };

  const toggleLike = async (postId) => {
    const pid = String(postId || "").trim();
    if (!pid) return;
    if (!user?.uid || !myMember) {
      setStatus("Join this group to like posts.");
      return;
    }

    const likeRef = doc(db, "groups", groupId, "posts", pid, "likes", user.uid);
    const nextLiked = !Boolean(likedMap[pid]);
    setLikedMap((prev) => ({ ...prev, [pid]: nextLiked }));

    if (likeBurstTimeoutRef.current) clearTimeout(likeBurstTimeoutRef.current);
    setLikeBurstId(pid);
    likeBurstTimeoutRef.current = setTimeout(() => setLikeBurstId(""), 420);

    try {
      if (nextLiked) {
        await setDoc(likeRef, { uid: user.uid, createdAt: new Date().toISOString(), createdAtTs: serverTimestamp() });
      } else {
        await deleteDoc(likeRef);
      }
    } catch (err) {
      // revert optimistic state
      setLikedMap((prev) => ({ ...prev, [pid]: !nextLiked }));
    }
  };

  useEffect(() => {
    return () => {
      if (likeBurstTimeoutRef.current) clearTimeout(likeBurstTimeoutRef.current);
    };
  }, []);

  const renderPostCard = (p) => {
    const pid = String(p?.id || "");
    const isMine = Boolean(user?.uid && String(p?.userId) === String(user.uid));
    const canDelete = isMine || canManageMembers;
    const isOpen = openPostId === pid;
    const likeCount = Number.isFinite(Number(p?.likeCount)) ? Number(p.likeCount) : 0;
    const liked = Boolean(likedMap[pid]);
    const created = p?.createdAt ? new Date(p.createdAt).toLocaleString() : "";
    return (
      <article key={`post-${pid}`} className={`group-post-card ${isOpen ? "open" : ""}`}>
        <header className="group-post-head">
          {p?.avatar ? (
            <img className="group-post-avatar" src={p.avatar} alt={p.username || "User"} loading="lazy" />
          ) : (
            <div className="group-post-avatar placeholder" aria-hidden="true" />
          )}
          <div className="group-post-head-text">
            <div className="group-post-head-row">
              <Link className="discussion-user-link" to={`/profile/${p?.userId}`} state={{ from: fromPath }}>
                {String(p?.username || "User")}
              </Link>
              <span className="muted group-post-date">{created}</span>
            </div>
            <div className="muted group-post-subrow">
              {commentApprovalEnabled && <span className="pill">Approval</span>}
            </div>
          </div>
          <div className="group-post-head-actions">
            <button type="button" className="detail-link secondary" onClick={() => setOpenPostId((cur) => (cur === pid ? "" : pid))}>
              {isOpen ? "Close" : "View thread"}
            </button>
            {canDelete && (
              <button
                type="button"
                className="detail-link danger"
                onClick={() => {
                  const ok = window.confirm("Delete this post and its comments?");
                  if (ok) deletePost(pid);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </header>

        {p?.body ? <p className="muted group-post-body">{String(p.body)}</p> : null}

        {Array.isArray(p?.images) && p.images.length > 0 && (
          <div className="group-post-images">
            {p.images.slice(0, 6).map((src, idx) => (
              <img key={`post-${pid}-img-${idx}`} className="group-post-image" src={src} alt="attachment" loading="lazy" />
            ))}
          </div>
        )}

        <footer className="group-post-footer">
          <button
            type="button"
            className={`group-like-btn ${liked ? "liked" : ""} ${likeBurstId === pid ? "burst" : ""}`}
            onClick={() => toggleLike(pid)}
            aria-pressed={liked}
          >
            <span className="group-like-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true">
                <path
                  d="M12 21s-6.716-4.246-9.4-8.008C.64 10.27 1.2 6.98 3.556 5.424 5.416 4.2 7.96 4.62 9.6 6.226c.915.897 1.2 1.474 2.4 3.274 1.2-1.8 1.485-2.377 2.4-3.274 1.64-1.606 4.184-2.026 6.044-.802 2.356 1.556 2.916 4.846.956 7.568C18.716 16.754 12 21 12 21z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="group-like-label">{liked ? "Liked" : "Like"}</span>
            <span className="group-like-count">{likeCount}</span>
          </button>

          <button type="button" className="group-comment-btn" onClick={() => setOpenPostId((cur) => (cur === pid ? "" : pid))}>
            Comment
          </button>
        </footer>

        {isOpen && (
          <div className="group-thread-area">
            {commentApprovalEnabled && !canManageMembers && (
              <p className="muted" style={{ marginTop: 0 }}>
                Comments require approval by an officer/admin. Your comment will be queued.
              </p>
            )}

            <div className="group-thread-compose">
              <textarea
                rows={3}
                value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)}
                placeholder="Write a comment..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) postComment();
                }}
              />
              <div className="group-thread-tools">
                <button type="button" className="detail-link" onClick={postComment} disabled={!draftComment.trim()}>
                  Comment
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  Tip: Ctrl/Cmd+Enter to send.
                </span>
              </div>
              {commentStatus && <p className="muted" style={{ marginTop: 8 }}>{commentStatus}</p>}
            </div>

            {commentApprovalEnabled && canManageMembers && pendingComments.length > 0 && (
              <div className="publish-card" style={{ marginTop: 14 }}>
                <div className="results-bar" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>Pending comments</h4>
                  <span className="pill">{pendingComments.length}</span>
                </div>
                <div className="inbox-list">
                  {pendingComments.map((c) => (
                    <div key={`pending-${c.id}`} className="inbox-row">
                      {c.avatar ? (
                        <img className="inbox-avatar" src={c.avatar} alt={c.username || "User"} loading="lazy" />
                      ) : (
                        <div className="inbox-avatar placeholder" aria-hidden="true" />
                      )}
                      <div className="inbox-row-text">
                        <div className="inbox-row-title" style={{ alignItems: "baseline" }}>
                          <span className="discussion-user-link">{String(c.username || "User")}</span>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}
                          </span>
                        </div>
                        <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(c.body || "")}</p>
                        <div className="group-post-actions">
                          <button type="button" className="detail-link" onClick={() => approvePendingComment(c)}>
                            Approve
                          </button>
                          <button type="button" className="detail-link danger" onClick={() => rejectPendingComment(c)}>
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="publish-card" style={{ marginTop: 14 }}>
              <div className="results-bar" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>Comments</h4>
                <span className="pill">{comments.length}</span>
              </div>
              <div className="inbox-list">
                {commentPageItems.map((c) => {
                  const cid = String(c.id || "");
                  const isMyComment = Boolean(user?.uid && String(c.userId) === String(user.uid));
                  const canDeleteComment = isMyComment || canManageMembers;
                  return (
                    <div key={`comment-${cid}`} className="inbox-row">
                      {c.avatar ? (
                        <img className="inbox-avatar" src={c.avatar} alt={c.username || "User"} loading="lazy" />
                      ) : (
                        <div className="inbox-avatar placeholder" aria-hidden="true" />
                      )}
                      <div className="inbox-row-text">
                        <div className="inbox-row-title" style={{ alignItems: "baseline" }}>
                          <Link className="discussion-user-link" to={`/profile/${c.userId}`} state={{ from: fromPath }}>
                            {String(c.username || "User")}
                          </Link>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}
                          </span>
                        </div>
                        <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(c.body || "")}</p>
                        {canDeleteComment && (
                          <div className="group-post-actions">
                            <button
                              type="button"
                              className="detail-link danger"
                              onClick={() => {
                                const ok = window.confirm("Delete this comment?");
                                if (!ok) return;
                                deleteDoc(doc(db, "groups", groupId, "posts", openPostId, "comments", cid)).catch(() => {});
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {commentPageCount > 1 && (
                <div className="pagination group-pagination">
                  <ReactPaginate
                    previousLabel={"←"}
                    nextLabel={"→"}
                    breakLabel={"..."}
                    pageCount={commentPageCount}
                    marginPagesDisplayed={1}
                    pageRangeDisplayed={2}
                    onPageChange={(selected) => setCommentPage(selected.selected)}
                    forcePage={Math.max(0, Math.min(commentPage, commentPageCount - 1))}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    );
  };

  if (groupLoading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Loading threads…</h2>
        </section>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Group not found</h2>
          <p className="muted">This group may have been deleted or you may not have access.</p>
          <button type="button" className="detail-link" onClick={goBack}>
            ← Back
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <section className="detail-panel group-detail group-threads" style={{ "--group-accent": accent }}>
        <div className="detail-header">
          <div className="group-detail-head">
            <div className="group-detail-banner" style={group.background ? { backgroundImage: `url(${group.background})` } : undefined}>
              {!group.background && <div className="group-detail-banner placeholder" aria-hidden="true" />}
            </div>
            <div className={`group-detail-title ${style}`}>
              {group.avatar ? (
                <img className="group-avatar lg" src={group.avatar} alt={title} loading="lazy" />
              ) : (
                <div className="group-avatar lg placeholder" aria-hidden="true" />
              )}
              <div className="group-detail-title-text">
                <h2 style={{ margin: 0 }}>
                  {title} <span className="pill" style={{ marginLeft: 10 }}>Threads</span>
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  {memberCount !== null ? `${memberCount} member${memberCount === 1 ? "" : "s"}` : "Members"} •{" "}
                  {group.isPublic ? "Public" : "Private"}
                  {myMember?.role ? ` • You: ${roleLabel(myMember.role)}` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className="group-detail-actions">
            <button type="button" className="detail-link secondary" onClick={goBack}>
              ← Back
            </button>
            <Link className="detail-link secondary" to={`/groups/${groupId}`} state={{ from: fromPath }}>
              Group
            </Link>
            {!user && <Link className="detail-link" to="/profile" state={{ from: fromPath }}>Sign in</Link>}
            {user && !myMember && (
              <button type="button" className="detail-link" onClick={joinGroup}>
                Join
              </button>
            )}
            {user && myMember && (
              <>
                {isOwner ? (
                  <button type="button" className="detail-link danger" onClick={disbandGroup}>
                    Disband
                  </button>
                ) : (
                  <button type="button" className="detail-link danger" onClick={leaveGroup}>
                    Leave
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {group.description ? <p className="muted" style={{ marginTop: 10 }}>{group.description}</p> : null}
        {status && <p className="muted" style={{ marginTop: 10 }}>{status}</p>}

        {!user || !myMember ? (
          <div className="publish-card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Threads locked</h3>
            <p className="muted">
              Join this group to unlock threads, post updates, and participate in discussions.
            </p>
            {!user ? (
              <Link className="detail-link" to="/profile" state={{ from: fromPath }}>
                Sign in
              </Link>
            ) : (
              <button type="button" className="detail-link" onClick={joinGroup}>
                Join group
              </button>
            )}
          </div>
        ) : (
          <div className="group-feed-layout">
            <div className="group-feed-main">
              <div className="publish-card group-thread-compose">
                <div className="results-bar" style={{ marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>Create post</h3>
                  <span className="pill">{canManageMembers ? "OFFICER/ADMIN" : "MEMBER"}</span>
                </div>
                <textarea
                  rows={4}
                  className="group-thread-textarea"
                  value={draftPost}
                  onChange={(e) => setDraftPost(e.target.value)}
                  placeholder="Share an update, start a discussion, or drop a screenshot..."
                />
                <div className="group-thread-tools">
                  <button type="button" className="detail-link secondary" onClick={() => postFileRef.current?.click()}>
                    + Image
                  </button>
                  <input
                    ref={postFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => onPickPostImages(e.target.files)}
                  />
                  <button type="button" className="detail-link" onClick={createPost}>
                    Post
                  </button>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={() => {
                      setDraftPost("");
                      setPostImages([]);
                      setPostStatus("");
                    }}
                  >
                    Clear
                  </button>
                </div>
                {postImages.length > 0 && (
                  <div className="group-post-images" style={{ marginTop: 10 }}>
                    {postImages.map((src, idx) => (
                      <img key={`draftimg-${idx}`} className="group-post-image" src={src} alt={`attachment ${idx + 1}`} />
                    ))}
                  </div>
                )}
                {postStatus && <p className="muted" style={{ marginTop: 10 }}>{postStatus}</p>}
              </div>

              <div className="results-bar" style={{ marginTop: 14, marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Latest posts</h3>
                <span className="pill">{posts.length}</span>
              </div>
              {postsLoading && <p className="muted">Loading posts...</p>}
              {!postsLoading && posts.length === 0 && <p className="muted">No posts yet. Be the first.</p>}

              <div className="group-feed">
                {postPageItems.map((p) => renderPostCard(p))}
              </div>

              {postPageCount > 1 && (
                <div className="pagination group-pagination">
                  <ReactPaginate
                    previousLabel={"←"}
                    nextLabel={"→"}
                    breakLabel={"..."}
                    pageCount={postPageCount}
                    marginPagesDisplayed={1}
                    pageRangeDisplayed={2}
                    onPageChange={(selected) => setPostPage(selected.selected)}
                    forcePage={Math.max(0, Math.min(postPage, postPageCount - 1))}
                  />
                </div>
              )}
            </div>

            <aside className="group-feed-aside">
              <div className="publish-card">
                <div className="results-bar" style={{ marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>Thread settings</h3>
                  {commentApprovalEnabled ? <span className="pill">Approval ON</span> : <span className="pill muted">Open</span>}
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                  {commentApprovalEnabled
                    ? "When enabled, member comments go to a pending queue and are published by an officer/admin."
                    : "Any member can comment directly on posts."}
                </p>
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}

export default GroupThreads;
