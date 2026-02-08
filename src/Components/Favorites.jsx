import React, { useCallback, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { fetchAniListCoversByMalIds, getAniListCoverFromCache } from "../utils/anilist";
import "../styles.css";

function Favorites() {
  const { user, profile } = useAuth();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const dragItem = useRef(null);
  const normalizingRef = useRef(false);
  const pageSize = 10;
  const [activePage, setActivePage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [orderDrafts, setOrderDrafts] = useState({});
  const [statusDrafts, setStatusDrafts] = useState({});
  const orderDraftsRef = useRef(orderDrafts);
  const statusDraftsRef = useRef(statusDrafts);
  const [activeTab, setActiveTab] = useState("anime");
  const backfillRunningRef = useRef(false);
  const backfilledRef = useRef(new Set());
  const [aniCovers, setAniCovers] = useState({});
  const [publishStatus, setPublishStatus] = useState({});
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);

  useEffect(() => {
    orderDraftsRef.current = orderDrafts;
  }, [orderDrafts]);

  useEffect(() => {
    statusDraftsRef.current = statusDrafts;
  }, [statusDrafts]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const updateFavorite = useCallback(async (docId, updates) => {
    const favoriteRef = doc(db, "users", user.uid, "favorites", String(docId));
    await updateDoc(favoriteRef, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
  }, [user]);

  const removeFavorite = useCallback(async (docId) => {
    if (!user) return;
    const favoriteRef = doc(db, "users", user.uid, "favorites", String(docId));
    await deleteDoc(favoriteRef);
    setToast("Removed from Favorites");
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToast("");
    }, 2000);
  }, [user]);

  const publishReview = useCallback(async (item) => {
    if (!user) {
      return;
    }
    const reviewText = item.note?.trim();
    if (!reviewText) {
      return;
    }
    setPublishStatus((prev) => ({
      ...prev,
      [item.docId]: { state: "loading", message: "Publishing..." }
    }));
    const mediaType = item.mediaType ?? "anime";
    const reviewId = `${mediaType}_${item.mal_id}_${user.uid}`;
    const reviewRef = doc(db, "discussions", reviewId);
    try {
      const snapshot = await getDoc(reviewRef);
      const createdAt = snapshot.exists()
        ? snapshot.data().createdAt || new Date().toISOString()
        : new Date().toISOString();
      const cover =
        mediaType === "anime"
          ? aniCovers[item.mal_id] ||
            getAniListCoverFromCache(item.mal_id) ||
            item.image ||
            ""
          : item.image || "";
      const mediaUrl =
        mediaType === "manga"
          ? `https://myanimelist.net/manga/${item.mal_id}`
          : `https://myanimelist.net/anime/${item.mal_id}`;
      await setDoc(
        reviewRef,
        {
          mediaType,
          mediaId: item.mal_id,
          mediaTitle: item.title,
          mediaUrl,
          mediaImage: cover,
          animeId: item.mal_id,
          animeTitle: item.title,
          animeUrl: `https://myanimelist.net/anime/${item.mal_id}`,
          animeImage: cover,
          review: reviewText,
          rating: item.rating || "",
          userId: user.uid,
          userName: profile?.username || user.displayName || user.email || "Anonymous",
          userPhoto: profile?.avatar || user.photoURL || "",
          createdAt,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
      const message = snapshot.exists() ? "Review updated." : "Review published.";
      setPublishStatus((prev) => ({
        ...prev,
        [item.docId]: { state: "success", message }
      }));
    } catch (error) {
      setPublishStatus((prev) => ({
        ...prev,
        [item.docId]: { state: "error", message: "Publish failed. Try again." }
      }));
    }
  }, [aniCovers, profile?.avatar, profile?.username, user]);

  useEffect(() => {
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    const favoritesRef = collection(db, "users", user.uid, "favorites");
    const favoritesQuery = query(favoritesRef, orderBy("order", "asc"));
    const unsubscribe = onSnapshot(favoritesQuery, (snapshot) => {
      const data = snapshot.docs.map((docItem) => {
        const payload = docItem.data();
        return {
          docId: docItem.id,
          mediaType: payload.mediaType ?? "anime",
          ...payload
        };
      });
      setFavorites(data);
      setLoading(false);
      const activeItems = data.filter((item) => item.status !== "Completed");
      const completedItems = data.filter((item) => item.status === "Completed");
      const needsNormalization = (items) =>
        items.some((item) => {
          const orderValue = Number(item.order);
          return !Number.isInteger(orderValue) || orderValue < 1;
        });

      const hasDrafts =
        Object.keys(orderDraftsRef.current).length > 0 ||
        Object.keys(statusDraftsRef.current).length > 0;
      if ((needsNormalization(activeItems) || needsNormalization(completedItems)) && !normalizingRef.current && !hasDrafts) {
        normalizingRef.current = true;
        const activeSorted = sortActiveFavorites(activeItems);
        const updates = [
          ...activeSorted.map((item, index) =>
            updateFavorite(item.docId, { order: index + 1 })
          ),
          ...completedItems.map((item, index) =>
            updateFavorite(item.docId, { order: index + 1 })
          )
        ];
        Promise.all(updates).finally(() => {
          normalizingRef.current = false;
        });
      }

      setStatusDrafts((prev) => {
        const serverStatus = new Map(
          data.map((item) => [String(item.docId), item.status])
        );
        let changed = false;
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (serverStatus.get(String(key)) === next[key]) {
            delete next[key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, updateFavorite]);

  useEffect(() => {
    setActivePage(1);
    setCompletedPage(1);
  }, [activeTab]);

  const handleDragStart = (index) => {
    dragItem.current = index;
  };

  const handleDrop = async (index) => {
    if (dragItem.current === null || dragItem.current === index) {
      dragItem.current = null;
      return;
    }

    const updated = [...favorites];
    const [moved] = updated.splice(dragItem.current, 1);
    updated.splice(index, 0, moved);
    dragItem.current = null;

    setFavorites(updated);

    const updates = updated.map((item, idx) =>
      updateFavorite(item.docId, { order: idx + 1 })
    );
    await Promise.all(updates);
  };

  const getSelectStatus = (item) =>
    statusDrafts[item.docId] ?? item.status ?? "Plan to watch";

  const getListStatus = (item) =>
    statusDrafts[item.docId] === "Completed"
      ? item.status ?? "Plan to watch"
      : statusDrafts[item.docId] ?? item.status ?? "Plan to watch";

  const animeCount = favorites.filter((item) => (item.mediaType ?? "anime") === "anime").length;
  const mangaCount = favorites.filter((item) => (item.mediaType ?? "anime") === "manga").length;
  const tabFavorites = favorites.filter(
    (item) => (item.mediaType ?? "anime") === activeTab
  );

  useEffect(() => {
    if (activeTab === "anime" && animeCount === 0 && mangaCount > 0) {
      setActiveTab("manga");
    } else if (activeTab === "manga" && mangaCount === 0 && animeCount > 0) {
      setActiveTab("anime");
    }
  }, [activeTab, animeCount, mangaCount]);

  useEffect(() => {
    const runBackfill = async () => {
      if (!user || loading || backfillRunningRef.current) {
        return;
      }

      const missing = favorites.filter((item) => {
        if (backfilledRef.current.has(item.docId)) {
          return false;
        }
        if (item.mediaType === "manga") {
          return item.totalChapters === null || item.totalChapters === undefined;
        }
        return item.totalEpisodes === null || item.totalEpisodes === undefined;
      });

      if (missing.length === 0) {
        return;
      }

      backfillRunningRef.current = true;
      for (const item of missing) {
        try {
          const endpoint = item.mediaType === "manga" ? "manga" : "anime";
          const response = await fetch(`https://api.jikan.moe/v4/${endpoint}/${item.mal_id}`);
          const data = await response.json();
          if (item.mediaType === "manga") {
            const totalChapters = data?.data?.chapters ?? null;
            if (totalChapters !== null) {
              await updateFavorite(item.docId, { totalChapters });
            }
          } else {
            const totalEpisodes = data?.data?.episodes ?? null;
            if (totalEpisodes !== null) {
              await updateFavorite(item.docId, { totalEpisodes });
            }
          }
        } catch (error) {
          // ignore and continue
        } finally {
          backfilledRef.current.add(item.docId);
        }
      }
      backfillRunningRef.current = false;
    };

    runBackfill();
  }, [favorites, loading, updateFavorite, user]);

  useEffect(() => {
    const animeIds = favorites
      .filter((item) => (item.mediaType ?? "anime") === "anime")
      .map((item) => item.mal_id)
      .filter(Boolean);
    if (animeIds.length === 0) return undefined;

    let active = true;
    fetchAniListCoversByMalIds(animeIds).then((map) => {
      if (!active || map.size === 0) return;
      const next = Object.fromEntries(map);
      setAniCovers((prev) => ({ ...prev, ...next }));
    });

    return () => {
      active = false;
    };
  }, [favorites]);

  if (!user) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <h2>Favorites</h2>
          <p>Sign in with Google to save your favorite anime.</p>
          <Link className="detail-link" to="/">Back to search</Link>
        </section>
      </div>
    );
  }
  const activeFavorites = tabFavorites.filter((item) => getListStatus(item) !== "Completed");
  const completedFavorites = tabFavorites.filter((item) => getListStatus(item) === "Completed");

  const paginate = (items, page) => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  };

  const sortActiveFavorites = (items) =>
    [...items].sort((a, b) => {
      const statusA = getListStatus(a) === "Watching" ? 0 : 1;
      const statusB = getListStatus(b) === "Watching" ? 0 : 1;
      if (statusA !== statusB) {
        return statusA - statusB;
      }
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });

  const totalPages = (items) => Math.max(1, Math.ceil(items.length / pageSize));

  const getNextOrder = (status, mediaType = "anime") => {
    const pool = favorites.filter((item) => {
      const type = item.mediaType ?? "anime";
      if (type !== mediaType) {
        return false;
      }
      return status === "Completed"
        ? item.status === "Completed"
        : item.status !== "Completed";
    });
    const maxOrder = pool.reduce((max, item) => {
      const value = Number(item.order) || 0;
      return Math.max(max, value);
    }, 0);
    return maxOrder + 1;
  };

  const handleStatusChange = async (item, newStatus) => {
    setStatusDrafts((prev) => ({
      ...prev,
      [item.docId]: newStatus
    }));

    if (newStatus === "Completed") {
      return;
    }

    setFavorites((prev) =>
      prev.map((fav) =>
        fav.docId === item.docId ? { ...fav, status: newStatus } : fav
      )
    );
    await updateFavorite(item.docId, { status: newStatus });
  };

  const confirmCompleted = async (item) => {
    const nextOrder = getNextOrder("Completed", item.mediaType ?? "anime");
    const maxCount = item.mediaType === "manga" ? item.totalChapters : item.totalEpisodes;
    const progressField = item.mediaType === "manga" ? "currentChapter" : "currentEpisode";
    await updateFavorite(item.docId, {
      status: "Completed",
      order: nextOrder,
      ...(maxCount ? { [progressField]: maxCount } : {})
    });
  };

  const reorderWithinSection = async (item, nextOrder, statusOverride) => {
    const targetOrder = Math.max(1, Number(nextOrder) || 1);
    const effectiveStatus = statusOverride ?? item.status;
    const isCompleted = effectiveStatus === "Completed";
    const mediaType = item.mediaType ?? "anime";
    const sectionItems = favorites
      .filter((fav) => {
        const type = fav.mediaType ?? "anime";
        if (type !== mediaType) {
          return false;
        }
        return isCompleted ? fav.status === "Completed" : fav.status !== "Completed";
      })
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const currentIndex = sectionItems.findIndex((fav) => fav.docId === item.docId);
    if (currentIndex === -1) {
      sectionItems.push({ ...item, status: effectiveStatus });
    }

    const clampedOrder = Math.min(targetOrder, sectionItems.length);
    const [moved] = currentIndex === -1 ? [sectionItems.pop()] : sectionItems.splice(currentIndex, 1);
    moved.status = effectiveStatus;
    sectionItems.splice(clampedOrder - 1, 0, moved);

    setFavorites((prev) =>
      prev.map((fav) => {
        const updatedIndex = sectionItems.findIndex((s) => s.docId === fav.docId);
        if (updatedIndex === -1) {
          return fav;
        }
        return { ...fav, order: updatedIndex + 1, status: fav.docId === item.docId ? effectiveStatus : fav.status };
      })
    );

    const updates = sectionItems.map((fav, index) =>
      updateFavorite(fav.docId, { order: index + 1 })
    );
    if (statusOverride) {
      updates.push(updateFavorite(item.docId, { status: effectiveStatus }));
    }
    await Promise.all(updates);
  };

  const applyOrderChange = async (item) => {
    const draftValue = orderDrafts[item.docId];
    const nextValue = Math.max(1, Number(draftValue) || 1);
    setOrderDrafts((prev) => {
      const copy = { ...prev };
      delete copy[item.docId];
      return copy;
    });
    await reorderWithinSection(item, nextValue);
  };

  const renderFavorites = (items, sectionLabel, page, setPage, isActiveSection = false) => (
    <div className="favorites-section">
      <div className="results-bar">
        <h3>{sectionLabel}</h3>
        <span className="pill">{items.length} saved</span>
      </div>
      {items.length === 0 ? (
        <p>No anime in this section yet.</p>
      ) : (
        <div className="favorites-grid">
          {paginate(isActiveSection ? sortActiveFavorites(items) : items, page).map((item) => (
            <div
              className="favorite-card"
              key={`favorite-${sectionLabel}-${item.docId}`}
              draggable
              onDragStart={() =>
                handleDragStart(favorites.findIndex((fav) => fav.docId === item.docId))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={() =>
                handleDrop(favorites.findIndex((fav) => fav.docId === item.docId))
              }
            >
              {/*
                Prefer AniList covers for anime; fall back to stored image for manga.
              */}
              {(() => {
                const cover =
                  (item.mediaType ?? "anime") === "anime"
                    ? aniCovers[item.mal_id] || getAniListCoverFromCache(item.mal_id)
                    : item.image;
                return (
                  <Link
                    className="favorite-cover"
                    to={item.mediaType === "manga" ? `/manga/${item.mal_id}` : `/anime/${item.mal_id}`}
                  >
                    {cover ? (
                      <img src={cover} alt={item.title} />
                    ) : (
                      <div className="cover-placeholder" aria-label={`${item.title} cover unavailable`}></div>
                    )}
                  </Link>
                );
              })()}
              <div className="favorite-body">
                <div className="favorite-title">
                  <Link to={item.mediaType === "manga" ? `/manga/${item.mal_id}` : `/anime/${item.mal_id}`}>
                    {item.title}
                  </Link>
                  {item.hasTrailer && <span className="catalog-badge">Trailer</span>}
                </div>
                <div className="favorite-row">
                  <label>
                    Status
                    <select
                      value={getSelectStatus(item)}
                      onChange={(e) => handleStatusChange(item, e.target.value)}
                    >
                      <option>Plan to watch</option>
                      <option>Watching</option>
                      <option>Completed</option>
                    </select>
                  </label>
                  <label>
                    Rating
                    <select
                      value={item.rating || ""}
                      onChange={(e) => updateFavorite(item.docId, { rating: e.target.value })}
                    >
                      <option value="">Unrated</option>
                      {[...Array(10)].map((_, i) => (
                        <option key={`rate-${i + 1}`} value={String(i + 1)}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {item.mediaType === "manga" ? "Chapter" : "Episode"}
                    <div className="progress-field">
                      <input
                        type="number"
                        min="0"
                        max={
                          item.mediaType === "manga"
                            ? item.totalChapters ?? undefined
                            : item.totalEpisodes ?? undefined
                        }
                        value={
                          item.mediaType === "manga"
                            ? item.currentChapter ?? 0
                            : item.currentEpisode ?? 0
                        }
                        onChange={(e) =>
                          updateFavorite(item.docId, {
                            [item.mediaType === "manga" ? "currentChapter" : "currentEpisode"]:
                              Math.max(
                                0,
                                Math.min(
                                  Number(e.target.value) || 0,
                                  item.mediaType === "manga"
                                    ? (item.totalChapters ?? (Number(e.target.value) || 0))
                                    : (item.totalEpisodes ?? (Number(e.target.value) || 0))
                                )
                              )
                          })
                        }
                      />
                      <span className="progress-max">
                        / {item.mediaType === "manga"
                          ? item.totalChapters ?? "?"
                          : item.totalEpisodes ?? "?"}
                      </span>
                    </div>
                  </label>
                    <label>
                      Order
                      <div className="order-input">
                        <input
                          type="number"
                          min="1"
                        value={orderDrafts[item.docId] ?? item.order ?? 1}
                        onChange={(e) =>
                          setOrderDrafts((prev) => ({
                            ...prev,
                            [item.docId]: e.target.value
                          }))
                        }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              applyOrderChange(item);
                            }
                          }}
                        />
                      </div>
                    </label>
                </div>
                <label className="favorite-note">
                  Notes
                  <textarea
                    rows={3}
                    value={item.note || ""}
                    onChange={(e) => updateFavorite(item.docId, { note: e.target.value })}
                    placeholder="Add a note about this title..."
                  ></textarea>
                </label>
                {statusDrafts[item.docId] === "Completed" && (
                  <button
                    className="complete-button"
                    type="button"
                    onClick={() => confirmCompleted(item)}
                  >
                    Save to Completed
                  </button>
                )}
                {getListStatus(item) === "Completed" && (
                  <button
                    className="publish-button"
                    type="button"
                    onClick={() => publishReview(item)}
                    disabled={!item.note || !item.note.trim()}
                    title={item.note?.trim() ? "Publish review to discussion" : "Add a note to publish"}
                  >
                    {publishStatus[item.docId]?.state === "success" ? "Published" : "Publish review"}
                  </button>
                )}
                {publishStatus[item.docId]?.message && (
                  <span className={`publish-status ${publishStatus[item.docId]?.state || ""}`}>
                    {publishStatus[item.docId]?.message}
                  </span>
                )}
                <button
                  className="remove-favorite-button"
                  type="button"
                  onClick={() => removeFavorite(item.docId)}
                >
                  Remove favorite
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length > pageSize && (
        <div className="pagination">
          <ul>
            {Array.from({ length: totalPages(items) }, (_, i) => (
              <li key={`${sectionLabel}-page-${i + 1}`}>
                <button
                  type="button"
                  onClick={() => setPage(i + 1)}
                  style={{
                    background: page === i + 1 ? "rgba(255,255,255,0.2)" : "transparent"
                  }}
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="layout">
      {toast && <div className="toast">{toast}</div>}
      <section className="detail-panel">
        <div className="results-bar">
          <div className="favorites-header">
            <h3>Your favorites</h3>
            <Link className="detail-link" to="/">Back to search</Link>
          </div>
          <span className="pill">{tabFavorites.length} total</span>
        </div>
        <div className="favorites-tabs">
          <button
            type="button"
            className={activeTab === "anime" ? "active" : ""}
            onClick={() => setActiveTab("anime")}
          >
            Anime ({animeCount})
          </button>
          <button
            type="button"
            className={activeTab === "manga" ? "active" : ""}
            onClick={() => setActiveTab("manga")}
          >
            Manga ({mangaCount})
          </button>
        </div>
        {loading ? (
          <p>Loading favorites...</p>
        ) : tabFavorites.length === 0 ? (
          <p>No favorites yet in this tab. Add some from the catalog.</p>
        ) : (
          <>
            {renderFavorites(activeFavorites, "In progress", activePage, setActivePage, true)}
            {renderFavorites(completedFavorites, "Completed", completedPage, setCompletedPage)}
          </>
        )}
      </section>
    </div>
  );
}

export default Favorites;
