import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import {
  fetchAniListCoversByMalIds,
  fetchAniListMangaCoversByMalIds,
  getAniListCoverFromCache,
  getAniListMangaCoverFromCache
} from "../utils/anilist";
import "../styles.css";

function PublicProfile() {
  const { uid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile: myProfile } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [favoritesActivity, setFavoritesActivity] = useState([]);
  const [favoritesActivityLoading, setFavoritesActivityLoading] = useState(false);
  const [activityAnimeCovers, setActivityAnimeCovers] = useState({});
  const [activityMangaCovers, setActivityMangaCovers] = useState({});
  const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
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

  useEffect(() => {
    if (!uid || !user || user.uid === uid) {
      setIsFollowing(false);
      return undefined;
    }
    const followerRef = doc(db, "users", uid, "followers", user.uid);
    const unsubscribe = onSnapshot(
      followerRef,
      (snap) => {
        setIsFollowing(snap.exists());
      },
      () => {
        setIsFollowing(false);
      }
    );
    return () => unsubscribe();
  }, [uid, user]);

  useEffect(() => {
    const isSelf = Boolean(user && uid && user.uid === uid);
    const canView = isSelf || isFollowing;
    if (!uid || !canView) {
      setFavoritesActivity([]);
      setFavoritesActivityLoading(false);
      return undefined;
    }
    setFavoritesActivityLoading(true);
    const activityRef = collection(db, "users", uid, "favoriteActivity");
    const q = query(activityRef, orderBy("clientAt", "desc"), limit(10));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((docItem) => {
          const data = docItem.data() || {};
          return {
            id: docItem.id,
            action: data.action || "updated",
            mediaType: data.mediaType || "anime",
            mal_id: Number(data.mal_id) || null,
            title: data.title || "Untitled",
            image: data.image || "",
            status: data.status || "",
            details: data.details || "",
            clientAt: data.clientAt || ""
          };
        });
        setFavoritesActivity(items);
        setFavoritesActivityLoading(false);
      },
      () => {
        setFavoritesActivity([]);
        setFavoritesActivityLoading(false);
      }
    );
    return () => unsubscribe();
  }, [isFollowing, uid, user]);

  useEffect(() => {
    const animeIds = favoritesActivity
      .filter((evt) => evt.mediaType === "anime" && evt.mal_id && !evt.image)
      .map((evt) => evt.mal_id)
      .filter(Boolean);
    const mangaIds = favoritesActivity
      .filter((evt) => evt.mediaType === "manga" && evt.mal_id && !evt.image)
      .map((evt) => evt.mal_id)
      .filter(Boolean);

    if (animeIds.length === 0 && mangaIds.length === 0) {
      return undefined;
    }

    let active = true;

    if (animeIds.length > 0) {
      fetchAniListCoversByMalIds(animeIds).then((map) => {
        if (!active || map.size === 0) return;
        const next = Object.fromEntries(map);
        setActivityAnimeCovers((prev) => ({ ...prev, ...next }));
      });
    }

    if (mangaIds.length > 0) {
      fetchAniListMangaCoversByMalIds(mangaIds).then((map) => {
        if (!active || map.size === 0) return;
        const next = Object.fromEntries(map);
        setActivityMangaCovers((prev) => ({ ...prev, ...next }));
      });
    }

    return () => {
      active = false;
    };
  }, [favoritesActivity]);

  const displayName = profile?.username || "Unknown user";
  const initials = useMemo(() => {
    return displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [displayName]);

  const isSelf = Boolean(user && uid && user.uid === uid);
  const canViewFavoritesActivity = isSelf || isFollowing;

  const toggleFollow = async () => {
    if (!user || !uid || isSelf) return;
    setFollowBusy(true);
    try {
      const batch = writeBatch(db);
      const targetFollowerRef = doc(db, "users", uid, "followers", user.uid);
      const myFollowingRef = doc(db, "users", user.uid, "following", uid);
      if (isFollowing) {
        batch.delete(targetFollowerRef);
        batch.delete(myFollowingRef);
      } else {
        const payload = {
          createdAt: serverTimestamp(),
          clientAt: new Date().toISOString(),
          fromUid: user.uid,
          fromName: myProfile?.username || user.displayName || user.email || "Anonymous",
          fromAvatar: myProfile?.avatar || user.photoURL || ""
        };
        batch.set(targetFollowerRef, payload, { merge: true });
        batch.set(myFollowingRef, payload, { merge: true });

        const inboxRef = collection(db, "users", uid, "inboxEvents");
        const inboxEventRef = doc(inboxRef);
        batch.set(inboxEventRef, {
          type: "follow",
          seen: false,
          clientAt: new Date().toISOString(),
          createdAt: serverTimestamp(),
          fromUid: user.uid,
          fromName: myProfile?.username || user.displayName || user.email || "Anonymous",
          fromAvatar: myProfile?.avatar || user.photoURL || ""
        });
      }
      await batch.commit();
    } catch (err) {
      // ignore
    } finally {
      setFollowBusy(false);
    }
  };

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
            {!isSelf && (
              <div className="public-actions">
                <button
                  type="button"
                  className={`follow-button ${isFollowing ? "active" : ""}`}
                  onClick={toggleFollow}
                  disabled={!user || followBusy}
                  title={!user ? "Sign in to follow users" : isFollowing ? "Unfollow" : "Follow"}
                >
                  {user ? (isFollowing ? "Following" : "Follow") : "Sign in to follow"}
                </button>
              </div>
            )}
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

        <div className="public-section">
          <div className="results-bar">
            <h3>Favorites activity</h3>
            <span className="pill">Latest 10 updates</span>
          </div>
          {!canViewFavoritesActivity ? (
            <div className="locked-panel">
              <div className="locked-overlay">
                <span className="locked-pill">Locked</span>
                <p className="muted">
                  Follow this user to unlock their latest Favorites updates.
                </p>
              </div>
              <div className="locked-preview">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div className="activity-row blurred" key={`locked-${index}`}>
                    <div className="activity-thumb placeholder"></div>
                    <div className="activity-text">
                      <div className="skeleton-line"></div>
                      <div className="skeleton-line short"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : favoritesActivityLoading ? (
            <p>Loading favorites activity...</p>
          ) : favoritesActivity.length === 0 ? (
            <p className="muted">No recent Favorites updates yet.</p>
          ) : (
            <div className="favorites-activity">
              {favoritesActivity.map((evt) => (
                <div className="activity-row" key={evt.id}>
                  {(() => {
                    const malId = evt.mal_id;
                    const cached =
                      evt.mediaType === "manga"
                        ? activityMangaCovers[malId] || getAniListMangaCoverFromCache(malId)
                        : activityAnimeCovers[malId] || getAniListCoverFromCache(malId);
                    const src = cached || evt.image || "";
                    if (!src || brokenThumbs.has(src)) {
                      return (
                        <div className="activity-thumb placeholder" aria-hidden="true"></div>
                      );
                    }
                    return (
                      <img
                        className="activity-thumb"
                        src={src}
                        alt={evt.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => {
                          setBrokenThumbs((prev) => new Set(prev).add(src));
                        }}
                      />
                    );
                  })()}
                  <div className="activity-text">
                    <div className="activity-title">
                      <span className={`activity-badge ${evt.action}`}>{evt.action.replace(/_/g, " ")}</span>
                      <span>{evt.title}</span>
                    </div>
                    <div className="activity-meta muted">
                      <span>{evt.mediaType}</span>
                      {evt.status && <span>Status: {evt.status}</span>}
                      <span>
                        {evt.clientAt ? new Date(evt.clientAt).toLocaleString() : ""}
                      </span>
                    </div>
                    {evt.details && <div className="activity-details muted">{evt.details}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default PublicProfile;
