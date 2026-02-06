import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collection, doc, getDocs, onSnapshot, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../AuthContext";
import { DiscussionPost } from "./Discussion";
import "../styles.css";

function DiscussionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);

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
          <Link className="detail-link" to="/discussion">Back to discussion</Link>
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
          <h3>{post.animeTitle}</h3>
          <Link className="detail-link" to="/discussion">Back to discussion</Link>
        </div>
        <div className="discussion-grid">
          <DiscussionPost
            post={post}
            user={user}
            onDelete={handleDelete}
            detailLink={false}
            draft={draft}
            onDraftChange={setDraft}
          />
        </div>
      </section>
    </div>
  );
}

export default DiscussionDetail;
