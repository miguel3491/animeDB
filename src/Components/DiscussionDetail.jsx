import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDocs, limit, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { DiscussionPost } from "./Discussion";
import "../styles.css";

function DiscussionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [spoilerBlurEnabled, setSpoilerBlurEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem("spoiler-blur-enabled");
      if (stored === null) return true;
      return stored === "1";
    } catch (err) {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("spoiler-blur-enabled", spoilerBlurEnabled ? "1" : "0");
    } catch (err) {
      // ignore
    }
  }, [spoilerBlurEnabled]);

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
    const ref = doc(db, "discussions", id);
    const unsub = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          setPost({ id: snapshot.id, ...snapshot.data() });
        } else {
          setPost(null);
        }
        setLoading(false);
      },
      () => {
        setPost(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [id]);

  useEffect(() => {
    // Mark inbox events as seen when the post owner opens the thread.
    if (!user?.uid) return;
    if (!post?.id) return;
    if (post.userId !== user.uid) return;

    let active = true;
    const mark = async () => {
      try {
        const inboxRef = collection(db, "users", user.uid, "inboxEvents");
        const q = query(inboxRef, where("seen", "==", false), limit(200));
        const snap = await getDocs(q);
        if (!active || snap.empty) return;

        const batch = writeBatch(db);
        let touched = 0;
        snap.docs.forEach((docItem) => {
          const data = docItem.data() || {};
          if (data.type !== "comment") return;
          if (data.discussionId !== post.id) return;
          batch.update(docItem.ref, { seen: true, seenAt: new Date().toISOString() });
          touched += 1;
        });
        if (touched > 0) {
          await batch.commit();
        }
      } catch (err) {
        // ignore
      }
    };

    mark();
    return () => {
      active = false;
    };
  }, [post?.id, post?.userId, user?.uid]);

  if (loading) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>Loading discussion...</p>
        </section>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="layout">
        <section className="detail-panel">
          <p>We could not find that discussion.</p>
          <button type="button" className="detail-link" onClick={goBack}>
            &#8592; Back to results
          </button>
        </section>
      </div>
    );
  }

  const handleDelete = async (target) => {
    if (!user || user.uid !== target.userId) return;
    const confirmed = window.confirm("Delete this review? This cannot be undone.");
    if (!confirmed) return;
    try {
      const commentsRef = collection(db, "discussions", target.id, "comments");
      const snapshot = await getDocs(commentsRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach((docItem) => {
        batch.delete(docItem.ref);
      });
      batch.delete(doc(db, "discussions", target.id));
      await batch.commit();
    } catch (error) {
      window.alert("Unable to delete this post. Please try again.");
      return;
    }
    navigate("/discussion");
  };

  return (
    <div className="layout">
      <section>
        <div className="results-bar">
          <h3>{post.mediaTitle || post.animeTitle}</h3>
          <div className="discussion-detail-actions">
            <button
              type="button"
              className={`spoiler-toggle ${spoilerBlurEnabled ? "active" : ""}`}
              onClick={() => setSpoilerBlurEnabled((prev) => !prev)}
              title={spoilerBlurEnabled ? "Spoiler Alert is ON (spoiler posts are blurred)" : "Spoiler Alert is OFF (spoiler posts are visible)"}
            >
              Spoiler Alert: {spoilerBlurEnabled ? "ON" : "OFF"}
            </button>
            <button type="button" className="detail-link" onClick={goBack}>
              &#8592; Back to results
            </button>
          </div>
        </div>
        <div className="discussion-grid">
          <DiscussionPost
            post={post}
            user={user}
            onDelete={handleDelete}
            detailLink={false}
            commentMode="thread"
            draft={draft}
            onDraftChange={setDraft}
            spoilerBlurEnabled={spoilerBlurEnabled}
          />
        </div>
      </section>
    </div>
  );
}

export default DiscussionDetail;
