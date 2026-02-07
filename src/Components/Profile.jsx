import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../AuthContext";
import { db } from "../firebase";
import "../styles.css";

function Profile() {
  const { user, profile, updateProfile } = useAuth();
  const [draftName, setDraftName] = useState(profile?.username || "");
  const [status, setStatus] = useState("");
  const fileRef = useRef(null);
  const bgRef = useRef(null);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    setDraftName(profile?.username || "");
  }, [profile?.username]);

  useEffect(() => {
    let active = true;
    const loadActivity = async () => {
      if (!user?.uid) return;
      setActivityLoading(true);
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const activityRef = collection(db, "users", user.uid, "commentActivity");
        const activityQuery = query(
          activityRef,
          where("commentedAt", ">=", since),
          orderBy("commentedAt", "desc"),
          limit(5)
        );
        const activitySnap = await getDocs(activityQuery);
        const details = activitySnap.docs.map((docItem) => {
          const data = docItem.data() || {};
          return {
            id: data.discussionId || docItem.id,
            commentedAt: data.commentedAt || "",
            title: data.mediaTitle || data.title || "Untitled",
            image: data.mediaImage || data.image || "",
            mediaType: data.mediaType || "anime"
          };
        });
        if (active) {
          setActivity(details);
        }
      } catch (err) {
        if (active) {
          setActivity([]);
        }
      } finally {
        if (active) {
          setActivityLoading(false);
        }
      }
    };

    loadActivity();
    return () => {
      active = false;
    };
  }, [user?.uid]);

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
      try {
        await updateProfile({ [field]: dataUrl });
        setStatus("Profile updated.");
      } catch (err) {
        setStatus(err?.message || "Profile update failed.");
      }
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    const nextName = draftName.trim();
    if (!nextName) {
      setStatus("Enter a display name.");
      return;
    }
    try {
      await updateProfile({ username: nextName });
      setStatus("Profile saved.");
    } catch (err) {
      setStatus(err?.message || "Profile update failed.");
    }
  };

  if (!user) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Profile</h2>
          <p>Sign in to edit your profile.</p>
          <Link className="detail-link" to="/">Back to home</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <section className="detail-panel">
        <div className="results-bar">
          <h3>Your profile</h3>
          <Link className="detail-link" to="/">Back to home</Link>
        </div>
        <div className="profile-page">
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
            <button type="button" className="upload-button" onClick={() => fileRef.current?.click()}>
              Upload avatar
            </button>
            <button type="button" className="upload-button" onClick={() => bgRef.current?.click()}>
              Upload header background
            </button>
          </div>
          <div className="profile-row">
            <button type="button" className="save-button" onClick={saveProfile}>
              Save profile
            </button>
            <button type="button" className="reset-button" onClick={() => updateProfile({ avatar: "", background: "" })}>
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
        <div className="public-section">
          <div className="results-bar">
            <h3>Your recent discussions</h3>
            <span className="pill">Last 7 days</span>
          </div>
          {activityLoading ? (
            <p>Loading activity...</p>
          ) : activity.length === 0 ? (
            <p className="muted">No discussion activity in the last 7 days.</p>
          ) : (
            <div className="public-activity-grid">
              {activity.map((item) => (
                <Link className="public-activity-card" key={item.id} to={`/discussion/${item.id}`}>
                  {item.image ? (
                    <img src={item.image} alt={item.title} />
                  ) : (
                    <div className="public-activity-image placeholder"></div>
                  )}
                  <div>
                    <h4>{item.title}</h4>
                    <p className="muted">
                      Commented {item.commentedAt ? new Date(item.commentedAt).toLocaleDateString() : "recently"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Profile;
