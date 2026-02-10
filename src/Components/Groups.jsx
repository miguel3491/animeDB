import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

const GROUP_PAGE_SIZE = 18;

const safeText = (value) => String(value || "").trim();

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function Groups() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fromPath = `${location.pathname}${location.search || ""}`;

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("browse");
  const [myGroups, setMyGroups] = useState([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState("#7afcff");
  const [nameStyle, setNameStyle] = useState("neon");
  const [avatar, setAvatar] = useState("");
  const [background, setBackground] = useState("");
  const [status, setStatus] = useState("");
  const creatingRef = useRef(false);
  const myGroupsBackfilledRef = useRef(false);

  const canCreate = Boolean(user?.uid);

  useEffect(() => {
    setLoading(true);
    const ref = collection(db, "groups");
    const q = query(ref, orderBy("updatedAt", "desc"), limit(GROUP_PAGE_SIZE));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setGroups(rows);
        setLoading(false);
      },
      () => {
        setGroups([]);
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setMyGroups([]);
      return;
    }
    const ref = collection(db, "users", user.uid, "groups");
    const q = query(ref, orderBy("joinedAt", "desc"), limit(50));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMyGroups(rows);

        // Best-effort backfill so public profiles can show your group memberships
        // without reading group rosters. (Cloud Functions also maintain this, but
        // this helps existing data converge faster.)
        if (!myGroupsBackfilledRef.current && rows.length > 0) {
          myGroupsBackfilledRef.current = true;
          try {
            const batch = writeBatch(db);
            let wrote = 0;
            rows.forEach((r) => {
              const gid = String(r.groupId || r.id || "").trim();
              const joinedAt = String(r.joinedAt || new Date().toISOString());
              if (!gid) return;
              batch.set(doc(db, "users", user.uid, "publicGroups", gid), { groupId: gid, joinedAt }, { merge: true });
              wrote += 1;
            });
            if (wrote > 0) {
              batch.commit().catch(() => {});
            }
          } catch (err) {
            // ignore
          }
        }
      },
      () => setMyGroups([])
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!createOpen) {
      setStatus("");
    }
  }, [createOpen]);

  const pageTitle = useMemo(() => {
    if (tab === "mine") return "My Groups";
    return "Groups";
  }, [tab]);

  const pickImage = async (file, field) => {
    if (!file) return;
    const maxSize = field === "background" ? 700 * 1024 : 450 * 1024;
    if (file.size > maxSize) {
      setStatus(`Image too large. Keep it under ${Math.round(maxSize / 1024)}KB.`);
      return;
    }
    try {
      const url = await readFileAsDataUrl(file);
      if (field === "avatar") setAvatar(String(url || ""));
      if (field === "background") setBackground(String(url || ""));
    } catch (err) {
      setStatus("Unable to read image. Try a different file.");
    }
  };

  const createGroup = async () => {
    if (!user?.uid) {
      setStatus("Sign in to create a group.");
      return;
    }
    if (creatingRef.current) return;
    const nextName = safeText(name);
    if (nextName.length < 3) {
      setStatus("Group name must be at least 3 characters.");
      return;
    }
    if (nextName.length > 40) {
      setStatus("Group name is too long (max 40).");
      return;
    }
    const nextDesc = safeText(description);
    const nowIso = new Date().toISOString();
    creatingRef.current = true;
    setStatus("Creating group...");
    try {
      const groupRef = doc(collection(db, "groups"));
      const memberRef = doc(db, "groups", groupRef.id, "members", user.uid);
      const userGroupRef = doc(db, "users", user.uid, "groups", groupRef.id);
      const publicGroupRef = doc(db, "users", user.uid, "publicGroups", groupRef.id);

      const payload = {
        name: nextName,
        description: nextDesc,
        ownerId: user.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdAtTs: serverTimestamp(),
        updatedAtTs: serverTimestamp(),
        isPublic: true,
        memberCount: 1,
        accent: accent || "#7afcff",
        nameStyle: nameStyle || "neon",
        avatar: avatar || "",
        background: background || ""
      };

      const memberPayload = {
        uid: user.uid,
        role: "admin",
        joinedAt: nowIso,
        createdAt: serverTimestamp(),
        username: profile?.username || user.displayName || user.email || "User",
        avatar: profile?.avatar || user.photoURL || ""
      };

      const userGroupPayload = {
        groupId: groupRef.id,
        role: "admin",
        joinedAt: nowIso,
        groupName: nextName,
        groupAvatar: avatar || "",
        groupAccent: accent || "#7afcff",
        nameStyle: nameStyle || "neon"
      };

      const batch = writeBatch(db);
      batch.set(groupRef, payload);
      batch.set(memberRef, memberPayload);
      batch.set(userGroupRef, userGroupPayload);
      batch.set(publicGroupRef, { groupId: groupRef.id, joinedAt: nowIso }, { merge: true });
      await batch.commit();

      setCreateOpen(false);
      setName("");
      setDescription("");
      setAvatar("");
      setBackground("");
      setStatus("");
      navigate(`/groups/${groupRef.id}`, { state: { from: fromPath } });
    } catch (err) {
      setStatus(err?.message || "Failed to create group.");
    } finally {
      creatingRef.current = false;
    }
  };

  const renderCard = (g, keyPrefix = "g") => {
    const gid = String(g?.id || g?.groupId || "").trim();
    const gName = g?.name || g?.groupName || "Untitled group";
    const gAccent = g?.accent || g?.groupAccent || "#7afcff";
    const gStyle = g?.nameStyle || "neon";
    const gAvatar = g?.avatar || g?.groupAvatar || "";
    const gBg = g?.background || "";
    const gCount = Number.isFinite(Number(g?.memberCount)) ? Number(g.memberCount) : null;
    const isOwner = Boolean(user?.uid && g?.ownerId && String(g.ownerId) === String(user.uid));
    const isAdmin = isOwner || String(g?.role || "").toLowerCase() === "admin";
    return (
      <Link
        key={`${keyPrefix}-${gid || gName}`}
        className="group-card"
        to={gid ? `/groups/${gid}` : "/groups"}
        state={{ from: fromPath }}
        style={{ "--group-accent": gAccent }}
      >
        <div className="group-card-banner" style={gBg ? { backgroundImage: `url(${gBg})` } : undefined}>
          {!gBg && <div className="group-card-banner placeholder" aria-hidden="true" />}
        </div>
        <div className="group-card-body">
          <div className={`group-card-title ${gStyle}`}>
            {gAvatar ? (
              <img className="group-avatar" src={gAvatar} alt={gName} loading="lazy" />
            ) : (
              <div className="group-avatar placeholder" aria-hidden="true" />
            )}
            <div className="group-card-title-text">
              <div className="group-name">{gName}</div>
              <div className="muted group-meta">
                {gCount !== null ? `${gCount} member${gCount === 1 ? "" : "s"}` : "Open group"}{" "}
                {g?.ownerId ? `• Owner: ${String(g.ownerId).slice(0, 6)}…` : ""}
              </div>
            </div>
          </div>
          {g?.description || g?.groupDescription ? (
            <p className="muted group-desc">{g.description || g.groupDescription}</p>
          ) : (
            <p className="muted group-desc">No description.</p>
          )}
          <div className="group-card-actions">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="detail-link">View</span>
              {isAdmin && gid && (
                <button
                  type="button"
                  className="detail-link secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/groups/${gid}`, { state: { from: fromPath, openSettings: true } });
                  }}
                  title="Open customization"
                >
                  Customize
                </button>
              )}
            </div>
            {isAdmin ? (
              <span className="pill">ADMIN</span>
            ) : g?.role ? (
              <span className="pill">{String(g.role).toUpperCase()}</span>
            ) : (
              <span className="pill">PUBLIC</span>
            )}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <div className="layout">
      <section>
        <div className="hero group-hero">
          <h2>{pageTitle}</h2>
          <p className="muted">Create communities, manage roles, and customize the vibe.</p>
          <div className="group-hero-actions">
            <button type="button" className={tab === "browse" ? "active" : ""} onClick={() => setTab("browse")}>
              Browse
            </button>
            <button
              type="button"
              className={tab === "mine" ? "active" : ""}
              onClick={() => setTab("mine")}
              disabled={!user}
              title={!user ? "Sign in to view your groups" : ""}
            >
              My groups
            </button>
            <button type="button" className="detail-link" onClick={() => setCreateOpen(true)} disabled={!canCreate}>
              + Create group
            </button>
          </div>
          {!user && <p className="muted" style={{ marginTop: 10 }}>Sign in to create groups and join communities.</p>}
        </div>

        {createOpen && (
          <div className="publish-card group-create">
            <div className="results-bar" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Create a group</h3>
              <button type="button" className="close-button" onClick={() => setCreateOpen(false)}>
                Close
              </button>
            </div>
            <div className="group-form">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Winter 2026 Watch Party" />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this group about?"
                />
              </label>
              <div className="group-form-row">
                <label className="group-inline">
                  Accent
                  <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
                </label>
                <label className="group-inline">
                  Name style
                  <select value={nameStyle} onChange={(e) => setNameStyle(e.target.value)}>
                    <option value="neon">Neon</option>
                    <option value="solid">Solid</option>
                    <option value="gradient">Gradient</option>
                  </select>
                </label>
              </div>
              <div className="group-form-row">
                <label className="upload-button" style={{ display: "inline-flex", justifyContent: "center" }}>
                  Upload avatar
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => pickImage(e.target.files?.[0], "avatar")}
                  />
                </label>
                <label className="upload-button" style={{ display: "inline-flex", justifyContent: "center" }}>
                  Upload header background
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => pickImage(e.target.files?.[0], "background")}
                  />
                </label>
              </div>
              <div className="group-preview" style={{ "--group-accent": accent }}>
                <div className="group-preview-banner" style={background ? { backgroundImage: `url(${background})` } : undefined}>
                  {!background && <div className="group-preview-banner placeholder" aria-hidden="true" />}
                </div>
                <div className={`group-preview-name ${nameStyle}`}>
                  {avatar ? <img className="group-avatar" src={avatar} alt="avatar" /> : <div className="group-avatar placeholder" />}
                  <span>{name || "Group name preview"}</span>
                </div>
              </div>
              <div className="group-form-row">
                <button type="button" className="save-button" onClick={createGroup} disabled={!canCreate}>
                  Create
                </button>
                <button
                  type="button"
                  className="reset-button"
                  onClick={() => {
                    setAvatar("");
                    setBackground("");
                    setAccent("#7afcff");
                    setNameStyle("neon");
                    setStatus("");
                  }}
                >
                  Reset
                </button>
              </div>
              {status && (
                <p className={`publish-status ${status.toLowerCase().includes("fail") ? "error" : ""}`}>{status}</p>
              )}
            </div>
          </div>
        )}

        {tab === "browse" ? (
          <>
            {loading ? <p className="muted">Loading groups...</p> : null}
            {!loading && groups.length === 0 ? <p className="muted">No groups yet. Create the first one.</p> : null}
            <div className="groups-grid">
              {groups.map((g) => renderCard(g, "browse"))}
            </div>
          </>
        ) : (
          <>
            {!user ? <p className="muted">Sign in to see your groups.</p> : null}
            {user && myGroups.length === 0 ? <p className="muted">You haven't joined any groups yet.</p> : null}
            <div className="groups-grid">
              {myGroups.map((g) => renderCard(g, "mine"))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default Groups;
