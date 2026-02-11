import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import "../styles.css";

const GROUP_FETCH_LIMIT = 200;
const GROUPS_PER_PAGE = 10;
const PIN_LIMIT = 3;

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

  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [tab, setTab] = useState("browse");
  const [myGroups, setMyGroups] = useState([]);
  const [pinned, setPinned] = useState([]);
  // Hydrated group docs: used for pinned groups and for groups referenced by "My Groups" mirror docs.
  const [pinnedDocs, setPinnedDocs] = useState({});
  const pinnedDocsRef = useRef({});
  const hydrateInFlightRef = useRef(new Set());
  const [pinFx, setPinFx] = useState({});
  const [browsePage, setBrowsePage] = useState(0);
  const [minePage, setMinePage] = useState(0);
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem("groups-view-mode");
      if (stored === "grid" || stored === "list" || stored === "compact") return stored;
    } catch (err) {
      // ignore
    }
    return "grid";
  });

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

  const showToast = (message) => {
    const msg = String(message || "").trim();
    if (!msg) return;
    setToast(msg);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToast("");
    }, 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pinnedDocsRef.current = pinnedDocs;
  }, [pinnedDocs]);

  useEffect(() => {
    setLoading(true);
    setGroupsError("");
    const ref = collection(db, "groups");
    // Avoid requiring a composite index here. We fetch a recent slice and sort client-side.
    const q = query(ref, orderBy("updatedAt", "desc"), limit(GROUP_FETCH_LIMIT));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ac = Number.isFinite(Number(a?.memberCount)) ? Number(a.memberCount) : 0;
            const bc = Number.isFinite(Number(b?.memberCount)) ? Number(b.memberCount) : 0;
            if (bc !== ac) return bc - ac;
            const au = String(a?.updatedAt || "");
            const bu = String(b?.updatedAt || "");
            return bu.localeCompare(au);
          });
        setGroups(rows);
        setLoading(false);
      },
      (err) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Groups browse snapshot failed:", err);
        }
        setGroupsError(err?.message || "Unable to load groups.");
        setGroups([]);
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setPinned([]);
      setPinnedDocs({});
      return;
    }
    const ref = collection(db, "users", user.uid, "pinnedGroups");
    const q = query(ref, orderBy("pinnedAt", "desc"), limit(PIN_LIMIT));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setPinned(rows);
      },
      () => setPinned([])
    );
  }, [user?.uid]);

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

  useEffect(() => {
    setBrowsePage(0);
    setMinePage(0);
  }, [tab]);

  useEffect(() => {
    try {
      localStorage.setItem("groups-view-mode", viewMode);
    } catch (err) {
      // ignore
    }
  }, [viewMode]);

  const ordinal = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n || "");
    const s = ["th", "st", "nd", "rd"];
    const v = num % 100;
    return `${num}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };

  const pinnedIds = useMemo(() => {
    return pinned.map((p) => String(p.groupId || p.id || "").trim()).filter(Boolean);
  }, [pinned]);

  const myGroupIds = useMemo(() => {
    return myGroups.map((g) => String(g?.groupId || g?.id || "").trim()).filter(Boolean);
  }, [myGroups]);

  const groupsById = useMemo(() => {
    const map = new Map();
    groups.forEach((g) => {
      const id = String(g?.id || "").trim();
      if (!id) return;
      map.set(id, g);
    });
    return map;
  }, [groups]);

  const groupRankById = useMemo(() => {
    // groups is already sorted by memberCount desc, so index+1 is rank.
    const map = new Map();
    groups.forEach((g, idx) => {
      const id = String(g?.id || "").trim();
      if (!id) return;
      map.set(id, idx + 1);
    });
    return map;
  }, [groups]);

  useEffect(() => {
    // Ensure group visuals (background/avatar/name) exist for:
    // - pinned groups
    // - groups in "My Groups" (mirror docs don't store background)
    const ids = Array.from(new Set([...pinnedIds, ...myGroupIds])).filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const missing = ids.filter((gid) => {
        if (!gid) return false;
        if (groupsById.has(gid)) return false;
        if (pinnedDocsRef.current?.[gid]) return false;
        if (hydrateInFlightRef.current.has(gid)) return false;
        return true;
      });
      const slice = missing.slice(0, 25);
      if (slice.length === 0) return;
      slice.forEach((gid) => hydrateInFlightRef.current.add(gid));
      try {
        const fetched = await Promise.all(
          slice.map(async (gid) => {
            try {
              const snap = await getDoc(doc(db, "groups", gid));
              if (!snap.exists()) return null;
              return { id: snap.id, ...(snap.data() || {}) };
            } catch (err) {
              return null;
            } finally {
              hydrateInFlightRef.current.delete(gid);
            }
          })
        );
        if (cancelled) return;
        const next = {};
        fetched.forEach((row) => {
          const id = String(row?.id || "").trim();
          if (!id) return;
          next[id] = row;
        });
        if (Object.keys(next).length > 0) {
          setPinnedDocs((prev) => ({ ...prev, ...next }));
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupsById, myGroupIds, pinnedIds]);

  useEffect(() => {
    if (!user?.uid) return;
    if (pinnedIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = {};
      await Promise.all(
        pinnedIds.map(async (gid) => {
          if (!gid) return;
          const already = pinnedDocs[gid] || groupsById.get(gid);
          if (already) {
            next[gid] = already;
            return;
          }
          try {
            const snap = await getDoc(doc(db, "groups", gid));
            if (snap.exists()) {
              next[gid] = { id: snap.id, ...(snap.data() || {}) };
            }
          } catch (err) {
            // ignore
          }
        })
      );
      if (cancelled) return;
      if (Object.keys(next).length > 0) {
        setPinnedDocs((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupsById, pinnedDocs, pinnedIds, user?.uid]);

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
        // memberCount is maintained by Cloud Functions on member create/delete.
        memberCount: 0,
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

  const togglePin = async (gidRaw, isPinned) => {
    if (!user?.uid) {
      showToast("Sign in to pin groups.");
      return;
    }
    const gid = String(gidRaw || "").trim();
    if (!gid) return;
    try {
      if (isPinned) {
        await deleteDoc(doc(db, "users", user.uid, "pinnedGroups", gid));
        setPinFx((prev) => ({ ...prev, [gid]: "unpin" }));
        window.setTimeout(() => {
          setPinFx((prev) => {
            if (!prev[gid]) return prev;
            const next = { ...prev };
            delete next[gid];
            return next;
          });
        }, 700);
        showToast("Unpinned group.");
        return;
      }
      if (pinnedIds.length >= PIN_LIMIT) {
        window.alert(`You can pin up to ${PIN_LIMIT} groups.`);
        return;
      }
      await setDoc(
        doc(db, "users", user.uid, "pinnedGroups", gid),
        { groupId: gid, pinnedAt: new Date().toISOString(), createdAt: serverTimestamp() },
        { merge: true }
      );
      setPinFx((prev) => ({ ...prev, [gid]: "pin" }));
      window.setTimeout(() => {
        setPinFx((prev) => {
          if (!prev[gid]) return prev;
          const next = { ...prev };
          delete next[gid];
          return next;
        });
        }, 900);
      showToast("Pinned group.");
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Failed to toggle pin:", err);
      }
      showToast(err?.message || "Unable to pin group.");
    }
  };

  const renderCard = (g, keyPrefix = "g", opts = {}) => {
    const gid = String(g?.id || g?.groupId || "").trim();
    const hydrated = (gid && (groupsById.get(gid) || pinnedDocs[gid])) || null;
    const gName = g?.name || g?.groupName || hydrated?.name || "Untitled group";
    const gAccent = g?.accent || g?.groupAccent || hydrated?.accent || "#7afcff";
    const gStyle = g?.nameStyle || hydrated?.nameStyle || "neon";
    const gAvatar = g?.avatar || g?.groupAvatar || hydrated?.avatar || "";
    const gBg = g?.background || hydrated?.background || "";
    const gCount = Number.isFinite(Number(g?.memberCount))
      ? Number(g.memberCount)
      : Number.isFinite(Number(hydrated?.memberCount))
      ? Number(hydrated.memberCount)
      : null;
    const isOwner = Boolean(user?.uid && g?.ownerId && String(g.ownerId) === String(user.uid));
    const isAdmin = isOwner || String(g?.role || "").toLowerCase() === "admin";
    const isPinned = Boolean(gid && pinnedIds.includes(gid));
    const fx = gid ? pinFx[gid] : "";
    const showPinButton = Boolean(opts?.showPinButton && user?.uid && gid);
    const rank = gid ? groupRankById.get(gid) : null;
    const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";
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
          {typeof rank === "number" && rank > 0 && (
            <div className={`group-rank ${rankClass}`} title={`Rank ${ordinal(rank)} by members`}>
              <span className="group-rank-num">#{rank}</span>
              {rank <= 3 ? <span className="group-rank-medal">Top</span> : null}
            </div>
          )}
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
              {showPinButton && (
                <button
                  type="button"
                  className={`group-pin-btn ${isPinned ? "pinned" : ""} ${fx === "pin" ? "pin-fx" : ""} ${
                    fx === "unpin" ? "unpin-fx" : ""
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePin(gid, isPinned);
                  }}
                  title={isPinned ? "Unpin group" : "Pin group"}
                  aria-pressed={isPinned}
                >
                  <span className="group-pin-icon" aria-hidden="true">
                    {isPinned ? "★" : "☆"}
                  </span>
                  <span className="group-pin-text">{isPinned ? "Pinned" : "Pin"}</span>
                </button>
              )}
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

  const pinnedGroupRows = useMemo(() => {
    const rows = pinnedIds
      .map((id) => pinnedDocs[id] || groupsById.get(id))
      .filter(Boolean)
      .slice(0, PIN_LIMIT);
    return rows;
  }, [groupsById, pinnedDocs, pinnedIds]);

  // Browse shows the global ranking (by memberCount). Pinned groups are a "My Groups" only feature
  // and should not affect browse ordering or remove items from browse.
  const browseSorted = useMemo(() => groups, [groups]);

  const browsePageCount = useMemo(() => {
    if (browseSorted.length <= GROUPS_PER_PAGE) return 0;
    return Math.max(1, Math.ceil(browseSorted.length / GROUPS_PER_PAGE));
  }, [browseSorted.length]);

  const browsePageItems = useMemo(() => {
    if (browseSorted.length === 0) return [];
    const safe = Math.max(0, Math.min(browsePage, Math.max(0, browsePageCount - 1)));
    const start = safe * GROUPS_PER_PAGE;
    return browseSorted.slice(start, start + GROUPS_PER_PAGE);
  }, [browseSorted, browsePage, browsePageCount]);

  const minePinned = useMemo(() => {
    const mineIds = new Set(myGroups.map((g) => String(g?.id || g?.groupId || "").trim()).filter(Boolean));
    return pinnedGroupRows.filter((g) => mineIds.has(String(g?.id || g?.groupId || "").trim()));
  }, [myGroups, pinnedGroupRows]);

  const mineNonPinned = useMemo(() => {
    const pinnedSet = new Set(minePinned.map((g) => String(g?.id || g?.groupId || "").trim()).filter(Boolean));
    const sorted = [...myGroups];
    // Best-effort sort: myGroups mirror may not have memberCount; fall back to group doc if we have it.
    sorted.sort((a, b) => {
      const aid = String(a?.id || a?.groupId || "").trim();
      const bid = String(b?.id || b?.groupId || "").trim();
      const ac = Number(groupsById.get(aid)?.memberCount || a?.memberCount || 0);
      const bc = Number(groupsById.get(bid)?.memberCount || b?.memberCount || 0);
      if (bc !== ac) return bc - ac;
      const au = String(groupsById.get(aid)?.updatedAt || a?.updatedAt || a?.joinedAt || "");
      const bu = String(groupsById.get(bid)?.updatedAt || b?.updatedAt || b?.joinedAt || "");
      return bu.localeCompare(au);
    });
    return sorted.filter((g) => {
      const gid = String(g?.id || g?.groupId || "").trim();
      return gid && !pinnedSet.has(gid);
    });
  }, [groupsById, minePinned, myGroups]);

  const minePageCount = useMemo(() => {
    if (mineNonPinned.length <= GROUPS_PER_PAGE) return 0;
    return Math.max(1, Math.ceil(mineNonPinned.length / GROUPS_PER_PAGE));
  }, [mineNonPinned.length]);

  const minePageItems = useMemo(() => {
    if (mineNonPinned.length === 0) return [];
    const safe = Math.max(0, Math.min(minePage, Math.max(0, minePageCount - 1)));
    const start = safe * GROUPS_PER_PAGE;
    return mineNonPinned.slice(start, start + GROUPS_PER_PAGE);
  }, [mineNonPinned, minePage, minePageCount]);

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

        <div className="results-bar">
          <h3>{tab === "mine" ? "Your Groups" : "Browse Groups"}</h3>
          <div className="results-controls">
            <div className="view-toggle">
              <button
                type="button"
                className={viewMode === "grid" ? "active" : ""}
                onClick={() => setViewMode("grid")}
                aria-label="Grid view"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                </svg>
              </button>
              <button
                type="button"
                className={viewMode === "list" ? "active" : ""}
                onClick={() => setViewMode("list")}
                aria-label="List view"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="3" rx="1.5"></rect>
                  <rect x="4" y="10.5" width="16" height="3" rx="1.5"></rect>
                  <rect x="4" y="16" width="16" height="3" rx="1.5"></rect>
                </svg>
              </button>
              <button
                type="button"
                className={viewMode === "compact" ? "active" : ""}
                onClick={() => setViewMode("compact")}
                aria-label="Compact view"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="6" height="6" rx="1.2"></rect>
                  <rect x="10" y="4" width="4" height="6" rx="1"></rect>
                  <rect x="15" y="4" width="6" height="6" rx="1.2"></rect>
                  <rect x="3" y="14" width="6" height="6" rx="1.2"></rect>
                  <rect x="10" y="14" width="4" height="6" rx="1"></rect>
                  <rect x="15" y="14" width="6" height="6" rx="1.2"></rect>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {tab === "browse" ? (
          <>
            {loading ? <p className="muted">Loading groups...</p> : null}
            {!loading && groupsError ? <p className="publish-status error">{groupsError}</p> : null}
            {!loading && groups.length === 0 ? <p className="muted">No groups yet. Create the first one.</p> : null}
            <div className={`groups-grid ${viewMode}`}>
              {browsePageItems.map((g) => renderCard(g, "browse", { showPinButton: false }))}
            </div>
            {browsePageCount > 1 && (
              <div className="pagination inbox-pagination" style={{ marginTop: 14 }}>
                <ReactPaginate
                  previousLabel={"←"}
                  nextLabel={"→"}
                  breakLabel={"..."}
                  pageCount={browsePageCount}
                  marginPagesDisplayed={1}
                  pageRangeDisplayed={2}
                  onPageChange={(selected) => setBrowsePage(selected.selected)}
                  forcePage={Math.max(0, Math.min(browsePage, browsePageCount - 1))}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {!user ? <p className="muted">Sign in to see your groups.</p> : null}
            {user && myGroups.length === 0 ? <p className="muted">You haven't joined any groups yet.</p> : null}
            <div className={`groups-grid ${viewMode}`}>
              {minePinned.map((g) => renderCard(g, "pinned-mine", { showPinButton: true }))}
              {minePageItems.map((g) => renderCard(g, "mine", { showPinButton: true }))}
            </div>
            {minePageCount > 1 && (
              <div className="pagination inbox-pagination" style={{ marginTop: 14 }}>
                <ReactPaginate
                  previousLabel={"←"}
                  nextLabel={"→"}
                  breakLabel={"..."}
                  pageCount={minePageCount}
                  marginPagesDisplayed={1}
                  pageRangeDisplayed={2}
                  onPageChange={(selected) => setMinePage(selected.selected)}
                  forcePage={Math.max(0, Math.min(minePage, minePageCount - 1))}
                />
              </div>
            )}
          </>
        )}
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default Groups;
