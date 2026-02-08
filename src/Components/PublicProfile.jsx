import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import "../styles.css";

function PublicProfile() {
  const { uid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const fromPath = `${location.pathname}${location.search || ""}`;

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
    navigate("/discussion");
  };

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      setLoading(true);
      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        if (!active) return;
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          setProfile(null);
        }
      } catch (err) {
        if (active) {
          setProfile(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    if (uid) {
      loadProfile();
    }

    return () => {
      active = false;
    };
  }, [uid]);

  useEffect(() => {
    let active = true;
    const loadActivity = async () => {
      if (!uid) return;
      setActivityLoading(true);
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const activityRef = collection(db, "users", uid, "commentActivity");
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
  }, [uid]);

  const displayName = profile?.username || "Unknown user";
  const initials = useMemo(() => {
    return displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [displayName]);

  if (loading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>Loading profile...</p>
        </section>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>This profile is unavailable.</p>
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <section className="detail-panel public-profile">
        <div
          className="public-hero"
          style={
            profile?.background
              ? { backgroundImage: `url(${profile.background})` }
              : undefined
          }
        >
          <div className="public-hero-overlay"></div>
          <div className="public-identity">
            {profile?.avatar ? (
              <img className="public-avatar" src={profile.avatar} alt={displayName} />
            ) : (
              <div className="public-avatar placeholder">{initials}</div>
            )}
            <div>
              <h2>{displayName}</h2>
              <p className="muted">Community member</p>
            </div>
          </div>
        </div>

        <div className="public-section">
          <div className="results-bar">
            <h3>Recent discussions commented</h3>
            <span className="pill">Last 7 days</span>
          </div>
          {activityLoading ? (
            <p>Loading activity...</p>
          ) : activity.length === 0 ? (
            <p className="muted">No discussion activity in the last 7 days.</p>
          ) : (
            <div className="public-activity-grid">
              {activity.map((item) => (
                <Link
                  className="public-activity-card"
                  key={item.id}
                  to={`/discussion/${item.id}`}
                  state={{ from: fromPath }}
                >
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

export default PublicProfile;
