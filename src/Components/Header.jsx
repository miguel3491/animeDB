import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";

function Header(){    
    const { user, loading, signIn, signOutUser, profile, updateProfile } = useAuth();
    const [open, setOpen] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [status, setStatus] = useState("");
    const [inboxCount, setInboxCount] = useState(0);
    const [inboxPop, setInboxPop] = useState(false);
    const [inboxHelpOpen, setInboxHelpOpen] = useState(false);
    const [inboxError, setInboxError] = useState("");
    const fileRef = useRef(null);
    const bgRef = useRef(null);
    const lastInboxRef = useRef(0);
    const inboxTimeoutRef = useRef(null);

    useEffect(() => {
        setDraftName(profile?.username || "");
    }, [profile?.username]);

    useEffect(() => {
        if (!open) {
            setInboxHelpOpen(false);
        }
    }, [open]);

    useEffect(() => {
        if (!user?.uid) {
            setInboxCount(0);
            setInboxError("");
            return;
        }

        const inboxRef = collection(db, "users", user.uid, "inboxEvents");
        // Limit to 100 unseen docs: we only ever display 0-99 or +99 in the UI.
        const inboxQuery = query(inboxRef, where("seen", "==", false), limit(100));
        const unsub = onSnapshot(
            inboxQuery,
            (snap) => {
                setInboxError("");
                setInboxCount(snap.size);
            },
            (err) => {
                if (process.env.NODE_ENV !== "production") {
                    console.warn("Inbox badge snapshot failed:", err);
                }
                setInboxError(err?.message || "Inbox unavailable.");
                setInboxCount(0);
            }
        );

        return () => unsub();
    }, [user?.uid]);

    useEffect(() => {
        if (inboxCount > 0 && inboxCount !== lastInboxRef.current) {
            setInboxPop(true);
            if (inboxTimeoutRef.current) {
                clearTimeout(inboxTimeoutRef.current);
            }
            inboxTimeoutRef.current = setTimeout(() => {
                setInboxPop(false);
            }, 420);
        }
        lastInboxRef.current = inboxCount;
        return () => {
            if (inboxTimeoutRef.current) {
                clearTimeout(inboxTimeoutRef.current);
            }
        };
    }, [inboxCount]);

    const initials = (profile?.username || "User")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");

    const formatInbox = (count) => {
        if (count > 99) return "+99";
        return String(count);
    };

    const onPickFile = (file, field) => {
        if (!file) return;
        const maxSize = 400 * 1024;
        if (file.size > maxSize) {
            setStatus("Image is too large. Keep it under 400KB.");
            return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
            const dataUrl = reader.result;
            await updateProfile({ [field]: dataUrl });
            setStatus("Profile updated.");
        };
        reader.readAsDataURL(file);
    };

    const saveProfile = async () => {
        const nextName = draftName.trim();
        if (!nextName) {
            setStatus("Enter a display name.");
            return;
        }
        await updateProfile({ username: nextName });
        setStatus("Profile saved.");
    };

    return(
        <nav
            className="nav-wrap"
            style={
                profile?.background
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(12, 18, 36, 0.9), rgba(12, 18, 36, 0.6)), url(${profile.background})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center"
                    }
                    : undefined
            }
        >
            <div className="nav-left">
                <Link className="title-link" to="/">
                    <h1 id = "Title">Anime<span>情報</span></h1>
                </Link>
            </div>
            <div className="header-actions">
                <span className="header-tagline">Curate your next obsession</span>
                <Link className="nav-link" to="/discussion">Discussion</Link>
                <Link className="nav-link" to="/news">News</Link>
                <Link className="nav-link" to="/favorites">Favorites</Link>
                {!loading && (
                    user ? (
                        <div className="profile-actions">
                            <div className="profile-trigger-wrap">
                                <button
                                    type="button"
                                    className="profile-trigger"
                                    onClick={() => setOpen((prev) => !prev)}
                                    title="Profile"
                                >
                                    {profile?.avatar ? (
                                        <img src={profile.avatar} alt={profile?.username || "Profile"} />
                                    ) : (
                                        <span>{initials}</span>
                                    )}
                                </button>
                                {inboxCount > 0 && (
                                    <span className={`profile-badge ${inboxPop ? "pop" : ""}`}>{formatInbox(inboxCount)}</span>
                                )}
                            </div>
                            {open && (
                                <div className="profile-panel">
                                    <div className="profile-header">
                                        <h4>Profile</h4>
                                        <button type="button" className="close-button" onClick={() => setOpen(false)}>
                                            Close
                                        </button>
                                    </div>
                                    <Link className="detail-link" to="/inbox" onClick={() => setOpen(false)}>
                                        Open inbox
                                    </Link>
                                    <Link className="detail-link" to="/profile" onClick={() => setOpen(false)}>
                                        Open profile page
                                    </Link>
                                    <label>
                                        Display name
                                        <input
                                            type="text"
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            placeholder="Choose a username"
                                        />
                                    </label>
                                    <div className="profile-row">
                                        <button
                                            type="button"
                                            className="upload-button"
                                            onClick={() => fileRef.current?.click()}
                                        >
                                            Upload avatar
                                        </button>
                                        <button
                                            type="button"
                                            className="upload-button"
                                            onClick={() => bgRef.current?.click()}
                                        >
                                            Upload header background
                                        </button>
                                    </div>
                                    <div className="profile-preview">
                                        {profile?.avatar ? (
                                            <img className="profile-preview-avatar" src={profile.avatar} alt="Avatar" />
                                        ) : (
                                            <div className="profile-preview-avatar placeholder"></div>
                                        )}
                                        {profile?.background ? (
                                            <div
                                                className="profile-preview-bg"
                                                style={{ backgroundImage: `url(${profile.background})` }}
                                            ></div>
                                        ) : (
                                            <div className="profile-preview-bg placeholder"></div>
                                        )}
                                    </div>
                                    <div className="profile-row">
                                        <button type="button" className="save-button" onClick={saveProfile}>
                                            Save profile
                                        </button>
                                        <button
                                            type="button"
                                            className="reset-button"
                                            onClick={() => updateProfile({ avatar: "", background: "" })}
                                        >
                                            Clear images
                                        </button>
                                    </div>
                                    <Link className="profile-inbox" to="/inbox" onClick={() => setOpen(false)}>
                                        <span>Inbox</span>
                                        <div className="profile-inbox-meta">
                                            <span className="profile-inbox-count">
                                                {inboxCount > 0 ? formatInbox(inboxCount) : "0"}
                                            </span>
                                            <button
                                                type="button"
                                                className="profile-inbox-help"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setInboxHelpOpen((prev) => !prev);
                                                }}
                                                aria-label="Inbox FAQ"
                                                title="Inbox FAQ"
                                            >
                                                ?
                                            </button>
                                        </div>
                                    </Link>
                                    {inboxHelpOpen && (
                                        <div className="profile-inbox-popover">
                                            <p className="muted">
                                                Inbox includes:
                                            </p>
                                            <p className="muted">
                                                1. New comments on your discussion posts (clears when you open the thread).
                                            </p>
                                            <p className="muted">
                                                2. New followers (clears when you mark followers as seen).
                                            </p>
                                            <p className="muted">
                                                3. Bug report updates (if the owner resolves your report).
                                            </p>
                                        </div>
                                    )}
                                    {inboxError && (
                                        <p className="publish-status error" style={{ margin: 0 }}>
                                            {inboxError}
                                        </p>
                                    )}
                                    {status && <p className="muted">{status}</p>}
                                    <button className="auth-button" type="button" onClick={signOutUser}>
                                        Sign out
                                    </button>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={(e) => onPickFile(e.target.files?.[0], "avatar")}
                                    />
                                    <input
                                        ref={bgRef}
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={(e) => onPickFile(e.target.files?.[0], "background")}
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <button className="auth-button" type="button" onClick={signIn}>
                            Sign in with Google
                        </button>
                    )
                )}
            </div>
        </nav>
    )
}
export default Header;
