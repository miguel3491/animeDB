import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";

function Header(){    
    const { user, loading, signIn, signOutUser, profile, updateProfile } = useAuth();
    const [open, setOpen] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [status, setStatus] = useState("");
    const fileRef = useRef(null);
    const bgRef = useRef(null);

    useEffect(() => {
        setDraftName(profile?.username || "");
    }, [profile?.username]);

    const initials = (profile?.username || "User")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");

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
                <button
                    type="button"
                    className="profile-trigger"
                    onClick={() => setOpen((prev) => !prev)}
                    disabled={!user}
                    title={user ? "Edit profile" : "Sign in to edit profile"}
                >
                    {profile?.avatar ? (
                        <img src={profile.avatar} alt={profile?.username || "Profile"} />
                    ) : (
                        <span>{initials}</span>
                    )}
                </button>
                {open && user && (
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
                        {status && <p className="muted">{status}</p>}
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
            <div className="header-actions">
                <span className="header-tagline">Curate your next obsession</span>
                <Link className="nav-link" to="/discussion">Discussion</Link>
                <Link className="nav-link" to="/news">News</Link>
                <Link className="nav-link" to="/favorites">Favorites</Link>
                {!loading && (
                    user ? (
                        <button className="auth-button" type="button" onClick={signOutUser}>
                            Sign out
                        </button>
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
