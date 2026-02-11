import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ReactPaginate from "react-paginate";
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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

function GroupDetail() {
  const { id } = useParams();
  const groupId = String(id || "").trim();
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fromPath = `${location.pathname}${location.search || ""}`;
  const openSettingsHandledRef = useRef(false);

  const [group, setGroup] = useState(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [myMember, setMyMember] = useState(null);
  const [status, setStatus] = useState("");
  const [memberPage, setMemberPage] = useState(0);
  const [tab, setTab] = useState("members"); // legacy: keep state so older thread code can stay gated

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

  const [editOpen, setEditOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftAccent, setDraftAccent] = useState("#7afcff");
  const [draftStyle, setDraftStyle] = useState("neon");
  const [draftAvatar, setDraftAvatar] = useState("");
  const [draftBackground, setDraftBackground] = useState("");
  const [draftApproval, setDraftApproval] = useState(false);

  const [inviteHandle, setInviteHandle] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [invitePreview, setInvitePreview] = useState(null);
  const [invitePreviewLoading, setInvitePreviewLoading] = useState(false);
  const inviteInflightRef = useRef(false);
  const invitePreviewTimeoutRef = useRef(null);
  const invitePreviewSeqRef = useRef(0);

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
        const data = snap.data() || {};
        setGroup({ id: snap.id, ...data });
        setDraftName(String(data.name || ""));
        setDraftDesc(String(data.description || ""));
        setDraftAccent(String(data.accent || "#7afcff"));
        setDraftStyle(String(data.nameStyle || "neon"));
        setDraftAvatar(String(data.avatar || ""));
        setDraftBackground(String(data.background || ""));
        setDraftApproval(Boolean(data.commentApprovalEnabled));
        setGroupLoading(false);
      },
      () => {
        setGroup(null);
        setGroupLoading(false);
      }
    );
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !user?.uid || !myMember) {
      setMembers([]);
      return;
    }
    const ref = collection(db, "groups", groupId, "members");
    const q = query(ref, orderBy("joinedAt", "desc"), limit(60));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMembers(rows);
      },
      () => setMembers([])
    );
  }, [groupId, myMember, tab, user?.uid]);

  useEffect(() => {
    setMemberPage(0);
  }, [groupId, members.length]);

  useEffect(() => {
    if (!groupId || !user?.uid) {
      setMyMember(null);
      return;
    }
    const ref = doc(db, "groups", groupId, "members", user.uid);
    return onSnapshot(
      ref,
      (snap) => {
        setMyMember(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      () => setMyMember(null)
    );
  }, [groupId, user?.uid]);

  useEffect(() => {
    if (!editOpen) {
      setStatus("");
      setInviteStatus("");
    }
  }, [editOpen]);

  const myRole = String(myMember?.role || "").toLowerCase();
  const isAdmin = myRole === "admin" || (user?.uid && group?.ownerId === user.uid);
  const isOfficer = myRole === "officer";
  const canManageMembers = isAdmin || isOfficer;
  const isOwner = Boolean(user?.uid && group?.ownerId && String(group.ownerId) === String(user.uid));
  const commentApprovalEnabled = Boolean(group?.commentApprovalEnabled);
  const canPostApprovedComment = !commentApprovalEnabled || canManageMembers;

  useEffect(() => {
    const wantsOpen = Boolean(location.state?.openSettings);
    if (!wantsOpen) return;
    if (openSettingsHandledRef.current) return;
    if (!isAdmin) return;
    openSettingsHandledRef.current = true;
    setEditOpen(true);
  }, [isAdmin, location.state]);

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
    navigate("/groups");
  };

  const pickImage = async (file, field) => {
    if (!file) return;
    const maxSize = field === "background" ? 700 * 1024 : 450 * 1024;
    if (file.size > maxSize) {
      setStatus(`Image too large. Keep it under ${Math.round(maxSize / 1024)}KB.`);
      return;
    }
    try {
      const url = await readFileAsDataUrl(file);
      if (field === "avatar") setDraftAvatar(String(url || ""));
      if (field === "background") setDraftBackground(String(url || ""));
    } catch (err) {
      setStatus("Unable to read image.");
    }
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

  const saveSettings = async () => {
    if (!groupId) return;
    if (!isAdmin) {
      setStatus("Only admins can edit group settings.");
      return;
    }
    const nextName = safeText(draftName);
    if (nextName.length < 3) {
      setStatus("Group name must be at least 3 characters.");
      return;
    }
    if (nextName.length > 40) {
      setStatus("Group name is too long (max 40).");
      return;
    }
    const nowIso = new Date().toISOString();
    try {
      setStatus("Saving...");
      await updateDoc(doc(db, "groups", groupId), {
        name: nextName,
        description: safeText(draftDesc),
        accent: safeText(draftAccent) || "#7afcff",
        nameStyle: safeText(draftStyle) || "neon",
        avatar: String(draftAvatar || ""),
        background: String(draftBackground || ""),
        commentApprovalEnabled: Boolean(draftApproval),
        updatedAt: nowIso,
        updatedAtTs: serverTimestamp()
      });
      setStatus("Saved.");
      setEditOpen(false);
    } catch (err) {
      setStatus(err?.message || "Unable to save.");
    }
  };

  const resolveHandleToUid = async (handleRaw) => {
    const key = String(handleRaw || "").trim().replace(/^@/, "").toLowerCase();
    if (!key) return "";
    try {
      const snap = await getDoc(doc(db, "usernames", key));
      const uid = snap.exists() ? snap.data()?.uid : "";
      return String(uid || "").trim();
    } catch (err) {
      return "";
    }
  };

  useEffect(() => {
    if (invitePreviewTimeoutRef.current) {
      clearTimeout(invitePreviewTimeoutRef.current);
    }
    const raw = safeText(inviteHandle);
    if (!raw) {
      setInvitePreview(null);
      setInvitePreviewLoading(false);
      return;
    }
    const handle = raw.replace(/^@/, "").toLowerCase();
    const seq = (invitePreviewSeqRef.current += 1);
    setInvitePreviewLoading(true);
    invitePreviewTimeoutRef.current = setTimeout(async () => {
      try {
        const uid = await resolveHandleToUid(handle);
        if (invitePreviewSeqRef.current !== seq) return;
        if (!uid) {
          setInvitePreview({ handle, uid: "", username: "", avatar: "" });
          return;
        }
        const snap = await getDoc(doc(db, "users", uid));
        const userData = snap.exists() ? snap.data() || {} : {};
        if (invitePreviewSeqRef.current !== seq) return;
        setInvitePreview({
          handle,
          uid,
          username: String(userData.username || "").trim(),
          avatar: String(userData.avatar || "").trim()
        });
      } catch (err) {
        if (invitePreviewSeqRef.current !== seq) return;
        setInvitePreview({ handle, uid: "", username: "", avatar: "" });
      } finally {
        if (invitePreviewSeqRef.current === seq) setInvitePreviewLoading(false);
      }
    }, 260);
    return () => {
      if (invitePreviewTimeoutRef.current) {
        clearTimeout(invitePreviewTimeoutRef.current);
      }
    };
  }, [inviteHandle]);

  const inviteMember = async () => {
    if (!canManageMembers) {
      setInviteStatus("Only admins/officers can add members.");
      return;
    }
    if (!groupId) return;
    if (!user?.uid) {
      setInviteStatus("Sign in to manage members.");
      return;
    }
    if (inviteInflightRef.current) return;
    const raw = safeText(inviteHandle);
    if (!raw) {
      setInviteStatus("Enter a @handle.");
      return;
    }
    inviteInflightRef.current = true;
    setInviteStatus("Looking up user...");
    try {
      const uid = invitePreview?.uid || (await resolveHandleToUid(raw));
      if (!uid) {
        setInviteStatus("User not found for that handle.");
        return;
      }
      const existing = members.some((m) => String(m.uid || m.id) === uid);
      if (existing) {
        setInviteStatus("That user is already a member.");
        return;
      }
      const snap = await getDoc(doc(db, "users", uid));
      const userData = snap.exists() ? snap.data() || {} : {};
      const nowIso = new Date().toISOString();
      const memberRef = doc(db, "groups", groupId, "members", uid);
      const userGroupRef = doc(db, "users", uid, "groups", groupId);
      const batch = writeBatch(db);
      batch.set(memberRef, {
        uid,
        role: "member",
        joinedAt: nowIso,
        createdAt: serverTimestamp(),
        username: userData.username || "User",
        avatar: userData.avatar || ""
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
      await batch.commit();
      setInviteHandle("");
      setInvitePreview(null);
      setInviteStatus("Added member.");
    } catch (err) {
      setInviteStatus(err?.message || "Unable to add member.");
    } finally {
      inviteInflightRef.current = false;
    }
  };

  const updateMemberRole = async (uid, role) => {
    if (!isAdmin) return;
    const nextRole = String(role || "member").toLowerCase();
    if (!["admin", "officer", "member"].includes(nextRole)) return;
    try {
      const memberRef = doc(db, "groups", groupId, "members", uid);
      const userGroupRef = doc(db, "users", uid, "groups", groupId);
      const batch = writeBatch(db);
      batch.update(memberRef, { role: nextRole });
      batch.set(userGroupRef, { role: nextRole }, { merge: true });
      await batch.commit();
    } catch (err) {
      // ignore
    }
  };

  const removeMember = async (uid) => {
    if (!canManageMembers) return;
    const safeUid = String(uid || "").trim();
    if (!safeUid) return;
    if (safeUid === group?.ownerId) {
      window.alert("You can't remove the group owner.");
      return;
    }
    const confirmed = window.confirm("Remove this member from the group?");
    if (!confirmed) return;
    try {
      const memberRef = doc(db, "groups", groupId, "members", safeUid);
      const userGroupRef = doc(db, "users", safeUid, "groups", groupId);
      const batch = writeBatch(db);
      batch.delete(memberRef);
      batch.delete(userGroupRef);
      await batch.commit();
    } catch (err) {
      // ignore
    }
  };

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
        createdAt: nowIso,
        createdAtTs: serverTimestamp(),
        updatedAt: nowIso,
        updatedAtTs: serverTimestamp()
      });
      setDraftPost("");
      setPostImages([]);
      setPostStatus("Posted.");
      setTab("threads");
      setOpenPostId((cur) => cur || postRef.id);
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

  useEffect(() => {
    setPostPage(0);
  }, [groupId, posts.length]);

  useEffect(() => {
    if (tab !== "threads" || !groupId || !user?.uid || !myMember) {
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

  useEffect(() => {
    if (tab !== "threads" || !groupId || !user?.uid || !myMember || !openPostId) {
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
  }, [canManageMembers, commentApprovalEnabled, groupId, myMember, openPostId, tab, user?.uid]);

  useEffect(() => {
    setCommentPage(0);
  }, [openPostId, comments.length]);

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

  const title = group?.name || "Group";
  const accent = group?.accent || "#7afcff";
  const style = group?.nameStyle || "neon";
  const memberCount = Number.isFinite(Number(group?.memberCount)) ? Number(group.memberCount) : null;

  const MEMBERS_PER_PAGE = 10;
  const memberPageCount = useMemo(() => {
    if (members.length === 0) return 0;
    return Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
  }, [members.length]);
  const memberPageItems = useMemo(() => {
    if (members.length === 0) return [];
    const safe = Math.max(0, Math.min(memberPage, Math.max(0, memberPageCount - 1)));
    const start = safe * MEMBERS_PER_PAGE;
    return members.slice(start, start + MEMBERS_PER_PAGE);
  }, [memberPage, memberPageCount, members]);

  const POSTS_PER_PAGE = 7;
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

  if (!groupId) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Group unavailable</h2>
          <button type="button" className="detail-link" onClick={() => navigate("/groups")}>
            Back to groups
          </button>
        </section>
      </div>
    );
  }

  if (groupLoading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Loading group…</h2>
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
      <section className="detail-panel group-detail" style={{ "--group-accent": accent }}>
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
                <h2 style={{ margin: 0 }}>{title}</h2>
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
            {user && isAdmin && (
              <button type="button" className="detail-link" onClick={() => setEditOpen((p) => !p)}>
                {editOpen ? "Close" : "Customize"}
              </button>
            )}
          </div>
        </div>

        {group.description ? <p className="muted" style={{ marginTop: 10 }}>{group.description}</p> : null}
        {status && <p className="muted" style={{ marginTop: 10 }}>{status}</p>}

        {editOpen && (
          <div className="publish-card" style={{ marginTop: 16 }}>
            <div className="results-bar" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Customize group</h3>
              <span className="pill">Admin</span>
            </div>
            <div className="group-form">
              <label>
                Name
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <label>
                Description
                <textarea rows={3} value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} />
              </label>
              <div className="group-form-row">
                <label className="group-inline">
                  Accent
                  <input type="color" value={draftAccent} onChange={(e) => setDraftAccent(e.target.value)} />
                </label>
                <label className="group-inline">
                  Name style
                  <select value={draftStyle} onChange={(e) => setDraftStyle(e.target.value)}>
                    <option value="neon">Neon</option>
                    <option value="solid">Solid</option>
                    <option value="gradient">Gradient</option>
                  </select>
                </label>
              </div>
              <div className="group-form-row">
                <label className="upload-button" style={{ display: "inline-flex", justifyContent: "center" }}>
                  Upload avatar
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pickImage(e.target.files?.[0], "avatar")} />
                </label>
                <label className="upload-button" style={{ display: "inline-flex", justifyContent: "center" }}>
                  Upload header background
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pickImage(e.target.files?.[0], "background")} />
                </label>
              </div>
              <div className="group-form-row">
                <button type="button" className="save-button" onClick={saveSettings}>
                  Save
                </button>
                <button
                  type="button"
                  className="reset-button"
                  onClick={() => {
                    setDraftAvatar("");
                    setDraftBackground("");
                  }}
                >
                  Clear images
                </button>
              </div>
              {isOwner && (
                <div className="group-form-row">
                  <label className="genre-filter" style={{ margin: 0 }}>
                    <span className="genre-label">Comment approval</span>
                    <select value={draftApproval ? "on" : "off"} onChange={(e) => setDraftApproval(e.target.value === "on")}>
                      <option value="off">Off (any member can comment)</option>
                      <option value="on">On (officer/admin approved only)</option>
                    </select>
                  </label>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Owner-only toggle. When enabled, member comments go to a pending queue.
                  </span>
                </div>
              )}
              {status && <p className={`publish-status ${status.toLowerCase().includes("unable") ? "error" : ""}`}>{status}</p>}
            </div>
          </div>
        )}

        <div className="group-tabbar" style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}/threads`, { state: { from: fromPath } })}
            title="Open the dedicated Threads feed"
          >
            Threads
          </button>
          <button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
            Members
          </button>
          {commentApprovalEnabled && <span className="pill">Comment approval ON</span>}
        </div>

        {tab === "threads" ? (
          <div className="group-thread-split" style={{ marginTop: 14 }}>
            <div className="group-thread-feed">
              {!user || !myMember ? (
                <div className="publish-card">
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
                    <div className="news-media-grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                      {postImages.map((src, idx) => (
                        <img key={`postimg-${idx}`} className="news-media-thumb" src={src} alt={`attachment ${idx + 1}`} />
                      ))}
                    </div>
                  )}
                  {postStatus && <p className="muted" style={{ marginTop: 10 }}>{postStatus}</p>}
                </div>
              )}

              {user && myMember && (
                <>
                  <div className="results-bar" style={{ marginTop: 14, marginBottom: 10 }}>
                    <h3 style={{ margin: 0 }}>Latest posts</h3>
                    <span className="pill">{posts.length}</span>
                  </div>
                  {postsLoading && <p className="muted">Loading posts...</p>}
                  {!postsLoading && posts.length === 0 && <p className="muted">No posts yet. Be the first.</p>}
                  <div className="inbox-list">
                    {postPageItems.map((p) => {
                      const pid = String(p.id || "");
                      const isMine = Boolean(user?.uid && String(p.userId) === String(user.uid));
                      const canDelete = isMine || canManageMembers;
                      return (
                        <div key={`post-${pid}`} className={`inbox-row group-post ${openPostId === pid ? "active" : ""}`}>
                          {p.avatar ? (
                            <img className="inbox-avatar" src={p.avatar} alt={p.username || "User"} loading="lazy" />
                          ) : (
                            <div className="inbox-avatar placeholder" aria-hidden="true" />
                          )}
                          <div className="inbox-row-text">
                            <div className="inbox-row-title" style={{ alignItems: "baseline" }}>
                              <Link className="discussion-user-link" to={`/profile/${p.userId}`} state={{ from: fromPath }}>
                                {String(p.username || "User")}
                              </Link>
                              <span className="muted" style={{ fontSize: 12 }}>
                                {p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}
                              </span>
                            </div>
                            {p.body ? <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(p.body)}</p> : null}
                            {Array.isArray(p.images) && p.images.length > 0 && (
                              <div className="news-media-grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                                {p.images.slice(0, 6).map((src, idx) => (
                                  <img key={`post-${pid}-img-${idx}`} className="news-media-thumb" src={src} alt="attachment" loading="lazy" />
                                ))}
                              </div>
                            )}
                            <div className="group-post-actions">
                              <button
                                type="button"
                                className="detail-link"
                                onClick={() => setOpenPostId((cur) => (cur === pid ? "" : pid))}
                              >
                                {openPostId === pid ? "Close thread" : "View thread"}
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
                          </div>
                        </div>
                      );
                    })}
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
                </>
              )}
            </div>

            <div className="group-thread-panel">
              <div className="results-bar" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Thread</h3>
                {openPostId ? <span className="pill">Open</span> : <span className="pill muted">Pick a post</span>}
              </div>

              {!user || !myMember ? (
                <p className="muted">Join the group to view threads.</p>
              ) : !openPostId ? (
                <p className="muted">Select a post from the left to view and reply.</p>
              ) : (
                <>
                  {commentApprovalEnabled && !canManageMembers && (
                    <p className="muted" style={{ marginTop: 0 }}>
                      Comments require approval by an officer/admin. Your comment will be queued.
                    </p>
                  )}
                  <div className="group-thread-commentbox">
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
                      <span className="muted" style={{ fontSize: 12 }}>Tip: Ctrl/Cmd+Enter to send.</span>
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
                        const isMine = Boolean(user?.uid && String(c.userId) === String(user.uid));
                        const canDelete = isMine || canManageMembers;
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
                              {canDelete && (
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
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="group-split" style={{ marginTop: 18 }}>
            <div className="group-members">
              {!user || !myMember ? (
                <div className="publish-card">
                  <h3 style={{ marginTop: 0 }}>Members locked</h3>
                  <p className="muted">Join this group to view the member list.</p>
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
                <>
                  <div className="results-bar" style={{ marginBottom: 10 }}>
                    <h3 style={{ margin: 0 }}>Members</h3>
                    <span className="pill">{members.length}</span>
                  </div>

                  {canManageMembers && (
                    <div className="group-invite">
                      <div className="search-wrap" style={{ flex: 1 }}>
                        <input
                          type="search"
                          placeholder="Add member by @handle"
                          value={inviteHandle}
                          onChange={(e) => setInviteHandle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") inviteMember();
                          }}
                        />
                      </div>
                      <button type="button" className="detail-link" onClick={inviteMember} disabled={!inviteHandle.trim()}>
                        Add
                      </button>
                    </div>
                  )}
                  {canManageMembers && (invitePreviewLoading || invitePreview) && (
                    <div className="mention-preview" aria-live="polite" style={{ marginTop: 10 }}>
                      <div className="mention-preview-head">
                        <span className="muted">Member preview</span>
                        {invitePreviewLoading && <span className="pill">Checking...</span>}
                      </div>
                      {invitePreview && (
                        <div className="mention-chips">
                          <span
                            className={`mention-chip ${invitePreview.uid ? "valid" : "invalid"}`}
                            title={invitePreview.uid ? `Will add @${invitePreview.handle}` : `Unknown handle: @${invitePreview.handle}`}
                          >
                            {invitePreview.avatar ? (
                              <img
                                className="mention-chip-avatar"
                                src={invitePreview.avatar}
                                alt={invitePreview.username || invitePreview.handle}
                                loading="lazy"
                              />
                            ) : (
                              <span className="mention-chip-avatar placeholder" aria-hidden="true"></span>
                            )}
                            <span className="mention-chip-text">@{invitePreview.handle}</span>
                            <span className="mention-chip-name">
                              {invitePreview.uid ? (invitePreview.username || "User") : "Not found"}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {inviteStatus && <p className="muted" style={{ marginTop: 8 }}>{inviteStatus}</p>}

                  <div className="inbox-list" style={{ marginTop: 10 }}>
                    {memberPageItems.map((m) => {
                      const uid = String(m.uid || m.id || "");
                      const uname = String(m.username || "User");
                      const uavatar = String(m.avatar || "");
                      const role = String(m.role || "member");
                      return (
                        <div key={`member-${uid}`} className="inbox-row" style={{ cursor: "default" }}>
                          {uavatar ? (
                            <img className="inbox-avatar" src={uavatar} alt={uname} loading="lazy" />
                          ) : (
                            <div className="inbox-avatar placeholder" aria-hidden="true" />
                          )}
                          <div className="inbox-row-text">
                            <div className="inbox-row-title">
                              <Link className="discussion-user-link" to={`/profile/${uid}`} state={{ from: fromPath }}>
                                {uname}
                              </Link>
                              <span className="pill muted">{roleLabel(role)}</span>
                            </div>
                            <p className="muted" style={{ marginTop: 4 }}>
                              Joined {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : "recently"}
                            </p>
                            {isAdmin && uid !== user?.uid && (
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                                <label className="genre-filter" style={{ margin: 0 }}>
                                  <span className="genre-label">Role</span>
                                  <select value={role} onChange={(e) => updateMemberRole(uid, e.target.value)}>
                                    <option value="member">Member</option>
                                    <option value="officer">Officer</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </label>
                                <button type="button" className="detail-link" onClick={() => removeMember(uid)}>
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {memberPageCount > 1 && (
                    <div className="pagination group-pagination">
                      <ReactPaginate
                        previousLabel={"←"}
                        nextLabel={"→"}
                        breakLabel={"..."}
                        pageCount={memberPageCount}
                        marginPagesDisplayed={1}
                        pageRangeDisplayed={2}
                        onPageChange={(selected) => setMemberPage(selected.selected)}
                        forcePage={Math.max(0, Math.min(memberPage, memberPageCount - 1))}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="group-perms">
              <div className="results-bar" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Permissions</h3>
                <span className="pill">v1</span>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                Admins can edit group settings and manage roles. Officers can add/remove members. Members can view and participate in threads after joining.
              </p>
              <p className="muted">
                Optional moderation: if comment approval is enabled, member comments go to a pending queue and must be approved by an officer/admin.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GroupDetail;
