import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ReactPaginate from "react-paginate";
import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
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

  const [editOpen, setEditOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftAccent, setDraftAccent] = useState("#7afcff");
  const [draftStyle, setDraftStyle] = useState("neon");
  const [draftAvatar, setDraftAvatar] = useState("");
  const [draftBackground, setDraftBackground] = useState("");

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
        setGroupLoading(false);
      },
      () => {
        setGroup(null);
        setGroupLoading(false);
      }
    );
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
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
  }, [groupId]);

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
      const groupRef = doc(db, "groups", groupId);
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
      batch.update(groupRef, { memberCount: increment(1), updatedAt: nowIso, updatedAtTs: serverTimestamp() });
      await batch.commit();
      setStatus("Joined.");
    } catch (err) {
      setStatus(err?.message || "Unable to join. Check Firestore permissions.");
    }
  };

  const leaveGroup = async () => {
    if (!user?.uid || !groupId) return;
    if (!myMember) return;
    const confirmed = window.confirm("Leave this group?");
    if (!confirmed) return;
    const nowIso = new Date().toISOString();
    try {
      setStatus("");
      const memberRef = doc(db, "groups", groupId, "members", user.uid);
      const userGroupRef = doc(db, "users", user.uid, "groups", groupId);
      const publicGroupRef = doc(db, "users", user.uid, "publicGroups", groupId);
      const groupRef = doc(db, "groups", groupId);
      const batch = writeBatch(db);
      batch.delete(memberRef);
      batch.delete(userGroupRef);
      batch.delete(publicGroupRef);
      batch.update(groupRef, { memberCount: increment(-1), updatedAt: nowIso, updatedAtTs: serverTimestamp() });
      await batch.commit();
      setStatus("Left group.");
    } catch (err) {
      setStatus(err?.message || "Unable to leave.");
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
      const groupRef = doc(db, "groups", groupId);
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
      batch.update(groupRef, { memberCount: increment(1), updatedAt: nowIso, updatedAtTs: serverTimestamp() });
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
    const nowIso = new Date().toISOString();
    try {
      const memberRef = doc(db, "groups", groupId, "members", safeUid);
      const userGroupRef = doc(db, "users", safeUid, "groups", groupId);
      const groupRef = doc(db, "groups", groupId);
      const batch = writeBatch(db);
      batch.delete(memberRef);
      batch.delete(userGroupRef);
      batch.update(groupRef, { memberCount: increment(-1), updatedAt: nowIso, updatedAtTs: serverTimestamp() });
      await batch.commit();
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
              <button type="button" className="detail-link danger" onClick={leaveGroup}>
                Leave
              </button>
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
              {status && <p className={`publish-status ${status.toLowerCase().includes("unable") ? "error" : ""}`}>{status}</p>}
            </div>
          </div>
        )}

        <div className="group-split" style={{ marginTop: 18 }}>
          <div className="group-members">
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
          </div>

          <div className="group-perms">
            <div className="results-bar" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Permissions</h3>
              <span className="pill">v1</span>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Admins can edit group settings and manage roles. Officers can add/remove members. Members can view and participate in future features.
            </p>
            <p className="muted">
              This structure keeps reads low: group metadata is one doc, and membership is stored under the group and mirrored under each user for fast “My groups”.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default GroupDetail;
