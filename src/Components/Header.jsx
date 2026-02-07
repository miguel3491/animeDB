import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

function Header(){    
    const { user, loading, signIn, signOutUser, profile, updateProfile } = useAuth();
    const [open, setOpen] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [status, setStatus] = useState("");
    const [inboxCount, setInboxCount] = useState(0);
    const fileRef = useRef(null);
    const bgRef = useRef(null);
    const commentUnsubsRef = useRef(new Map());
    const commentCacheRef = useRef(new Map());

    useEffect(() => {
        setDraftName(profile?.username || "");
    }, [profile?.username]);

    useEffect(() => {
        if (!user?.uid) {
            setInboxCount(0);
            commentUnsubsRef.current.forEach((unsub) => unsub());
            commentUnsubsRef.current.clear();
            commentCacheRef.current.clear();
            return;
        }

        const discussionsRef = collection(db, "discussions");
        const discussionsQuery = query(discussionsRef, where("userId", "==", user.uid));

        const unsubPosts = onSnapshot(discussionsQuery, (snapshot) => {
            const postIds = new Set();
            snapshot.docs.forEach((docItem) => {
                const postId = docItem.id;
                postIds.add(postId);
                if (commentUnsubsRef.current.has(postId)) {
                    return;
                }
                const commentsRef = collection(db, "discussions", postId, "comments");
                const commentsQuery = query(commentsRef, orderBy("createdAt", "asc"));
                const unsubComments = onSnapshot(commentsQuery, (commentSnap) => {
                    const timestamps = commentSnap.docs
                        .map((docItem) => docItem.data())
                        .filter((comment) => comment.userId !== user.uid)
                        .map((comment) => Date.parse(comment.createdAt || ""));
                    commentCacheRef.current.set(postId, timestamps);

                    let lastSeen = 0;
                    try {
                        lastSeen = Number(localStorage.getItem(`discussion-seen-${postId}`)) || 0;
                    } catch (err) {
                        lastSeen = 0;
                    }

                    const unread = timestamps.filter((time) => !Number.isNaN(time) && time > lastSeen).length;
                    const existing = commentCacheRef.current.get(`${postId}-count`) || 0;
                    if (existing !== unread) {
                        commentCacheRef.current.set(`${postId}-count`, unread);
                    }
                    const total = Array.from(commentCacheRef.current.entries())
                        .filter(([key]) => key.endsWith("-count"))
                        .reduce((sum, [, count]) => sum + count, 0);
                    setInboxCount(total);
                });
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
        });

        const handleSeen = (event) => {
            const postId = event?.detail?.postId;
            if (!postId || !commentCacheRef.current.has(postId)) return;
            const timestamps = commentCacheRef.current.get(postId) || [];
            let lastSeen = 0;
            try {
                lastSeen = Number(localStorage.getItem(`discussion-seen-${postId}`)) || 0;
            } catch (err) {
                lastSeen = 0;
            }
            const unread = timestamps.filter((time) => !Number.isNaN(time) && time > lastSeen).length;
            commentCacheRef.current.set(`${postId}-count`, unread);
            const total = Array.from(commentCacheRef.current.entries())
                .filter(([key]) => key.endsWith("-count"))
                .reduce((sum, [, count]) => sum + count, 0);
            setInboxCount(total);
        };

        window.addEventListener("discussion-seen", handleSeen);

        return () => {
            unsubPosts();
            window.removeEventListener("discussion-seen", handleSeen);
            commentUnsubsRef.current.forEach((unsub) => unsub());
            commentUnsubsRef.current.clear();
            commentCacheRef.current.clear();
        };
    }, [user?.uid]);

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
                                    <span className="profile-badge">{formatInbox(inboxCount)}</span>
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
                                    <div className="profile-inbox">
                                        <span>Inbox</span>
                                        <div className="profile-inbox-meta">
                                            <span className="profile-inbox-count">
                                                {inboxCount > 0 ? formatInbox(inboxCount) : "0"}
                                            </span>
                                            <button
                                                type="button"
                                                className="profile-inbox-help"
                                                title="Shows new comments on your discussion posts. The badge updates when you open the thread."
                                                aria-label="Inbox info"
                                            >
                                                ?
                                            </button>
                                        </div>
                                    </div>
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
