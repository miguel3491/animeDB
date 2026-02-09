import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, doc, getCountFromServer, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
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
  const [showUid, setShowUid] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followerCountLoading, setFollowerCountLoading] = useState(false);
  const [reportTitle, setReportTitle] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSteps, setReportSteps] = useState("");
  const [reportSeverity, setReportSeverity] = useState("Medium");
  const [reportType, setReportType] = useState("Bug");
  const [reportStatus, setReportStatus] = useState("");
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportUpdates, setReportUpdates] = useState([]);
  const [reportUpdatesLoading, setReportUpdatesLoading] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState("");
  const OWNER_UID = process.env.REACT_APP_OWNER_UID;
  const isOwner = Boolean(user?.uid && OWNER_UID && user.uid === OWNER_UID);
  const ARCHIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    setDraftName(profile?.username || "");
  }, [profile?.username]);

  useEffect(() => {
    setShowUid(false);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setFollowerCount(0);
      return;
    }
    let active = true;
    const loadCount = async () => {
      setFollowerCountLoading(true);
      try {
        const ref = collection(db, "users", user.uid, "followers");
        const snap = await getCountFromServer(ref);
        const count = Number(snap?.data?.().count ?? 0);
        if (active) setFollowerCount(Number.isFinite(count) ? count : 0);
      } catch (err) {
        if (active) setFollowerCount(0);
      } finally {
        if (active) setFollowerCountLoading(false);
      }
    };
    loadCount();
    return () => {
      active = false;
    };
  }, [user?.uid]);

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

  useEffect(() => {
    if (!user?.uid) {
      setReportUpdates([]);
      return;
    }
    let active = true;
    const loadUpdates = async () => {
      setReportUpdatesLoading(true);
      try {
        const updatesRef = collection(db, "users", user.uid, "bugReportUpdates");
        const updatesQuery = query(updatesRef, orderBy("resolvedAt", "desc"), limit(5));
        const snap = await getDocs(updatesQuery);
        const rows = snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
        if (active) {
          setReportUpdates(rows);
        }
      } catch (err) {
        if (active) {
          setReportUpdates([]);
        }
      } finally {
        if (active) {
          setReportUpdatesLoading(false);
        }
      }
    };
    loadUpdates();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!isOwner) {
      setReports([]);
      return;
    }
    let active = true;
    const archiveResolvedReports = async () => {
      try {
        const cutoff = Date.now() - ARCHIVE_AFTER_MS;
        const reportsRef = collection(db, "bugReports");
        const resolvedQuery = query(
          reportsRef,
          where("status", "==", "resolved"),
          orderBy("resolvedAt", "asc"),
          limit(50)
        );
        const snap = await getDocs(resolvedQuery);
        if (snap.empty) return;
        const batch = writeBatch(db);
        snap.docs.forEach((docItem) => {
          const data = docItem.data() || {};
          const resolvedAt = Date.parse(data.resolvedAt || "");
          if (!resolvedAt || Number.isNaN(resolvedAt) || resolvedAt > cutoff) return;
          batch.set(doc(db, "bugReportsArchive", docItem.id), {
            ...data,
            archivedAt: new Date().toISOString()
          });
          batch.delete(doc(db, "bugReports", docItem.id));
          if (data.reporterId) {
            batch.delete(doc(db, "users", data.reporterId, "bugReportUpdates", docItem.id));
          }
        });
        await batch.commit();
        if (active) {
          setArchiveStatus("Resolved reports are archived after 3 days.");
        }
      } catch (err) {
        if (active) {
          setArchiveStatus("");
        }
      }
    };
    const loadReports = async () => {
      setReportsLoading(true);
      try {
        await archiveResolvedReports();
        const reportsRef = collection(db, "bugReports");
        const reportsQuery = query(reportsRef, orderBy("createdAt", "desc"), limit(25));
        const snap = await getDocs(reportsQuery);
        const rows = snap.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
        if (active) {
          setReports(rows);
        }
      } catch (err) {
        if (active) {
          setReports([]);
        }
      } finally {
        if (active) {
          setReportsLoading(false);
        }
      }
    };
    loadReports();
    return () => {
      active = false;
    };
  }, [isOwner]);

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

  const submitBugReport = async () => {
    if (!reportTitle.trim() || !reportDetails.trim()) {
      setReportStatus("Add a title and description.");
      return;
    }
    try {
      await addDoc(collection(db, "bugReports"), {
        type: reportType,
        title: reportTitle.trim(),
        details: reportDetails.trim(),
        steps: reportSteps.trim(),
        severity: reportSeverity,
        pageUrl: window.location.href,
        createdAt: new Date().toISOString(),
        status: "open",
        reporterId: user.uid,
        reporterName: profile?.username || user.displayName || user.email || "Anonymous",
        reporterEmail: user.email || "",
        reporterAvatar: profile?.avatar || user.photoURL || "",
        ownerId: OWNER_UID || ""
      });
      setReportTitle("");
      setReportDetails("");
      setReportSteps("");
      setReportSeverity("Medium");
      setReportType("Bug");
      setReportStatus("Report submitted. Thank you!");
    } catch (err) {
      setReportStatus(err?.message || "Report failed to submit.");
    }
  };

  const resolveReport = async (item) => {
    if (!isOwner) return;
    try {
      const resolvedAt = new Date().toISOString();
      const reportRef = doc(db, "bugReports", item.id);
      await updateDoc(reportRef, {
        status: "resolved",
        resolvedAt,
        resolvedBy: user.uid
      });
      if (item.reporterId) {
        const updateRef = doc(db, "users", item.reporterId, "bugReportUpdates", item.id);
        await setDoc(
          updateRef,
          {
            reportId: item.id,
            title: item.title || "Bug report",
            status: "resolved",
            resolvedAt,
            message: "Your report has been resolved."
          },
          { merge: true }
        );

        // Mirror into the user's unified inbox feed.
        const inboxRef = doc(db, "users", item.reporterId, "inboxEvents", `bug-${item.id}`);
        await setDoc(
          inboxRef,
          {
            type: "bugReportUpdate",
            seen: false,
            clientAt: resolvedAt,
            createdAt: serverTimestamp(),
            toUid: item.reporterId,
            reportId: item.id,
            reportTitle: item.title || "Bug report"
          },
          { merge: true }
        );
      }
      setReports((prev) => prev.filter((report) => report.id !== item.id));
    } catch (err) {
      setReportStatus(err?.message || "Failed to resolve report.");
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
        <div className="results-controls" style={{ marginBottom: 14 }}>
          <span className="pill">
            Followers: {followerCountLoading ? "…" : followerCount}
          </span>
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
          <div className="muted">
            {!showUid ? (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const ok = window.confirm(
                    "Show your User ID? Anyone with it could identify your account in support requests."
                  );
                  if (ok) setShowUid(true);
                }}
              >
                Show User ID
              </button>
            ) : (
              <>
                <span>User ID: </span>
                <code>{user.uid}</code>
                <span className="uid-actions">
                  <button
                    type="button"
                    className="link-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(user.uid);
                        setStatus("User ID copied.");
                      } catch (err) {
                        setStatus("Unable to copy User ID.");
                      }
                    }}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setShowUid(false)}
                  >
                    Hide
                  </button>
                </span>
              </>
            )}
          </div>
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
            <h3>Send a report</h3>
            <span className="pill">Owner-only</span>
          </div>
          <div className="bug-report">
            <label>
              Type
              <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                <option>Bug</option>
                <option>Feature request</option>
                <option>Account issue</option>
                <option>Other</option>
              </select>
            </label>
            <label>
              Title
              <input
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="Short summary of the issue"
              />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="What happened? What did you expect?"
              ></textarea>
            </label>
            <label>
              Steps to reproduce (optional)
              <textarea
                rows={3}
                value={reportSteps}
                onChange={(e) => setReportSteps(e.target.value)}
                placeholder="1) ... 2) ..."
              ></textarea>
            </label>
            <label>
              Severity
              <select value={reportSeverity} onChange={(e) => setReportSeverity(e.target.value)}>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Critical</option>
              </select>
            </label>
            <button type="button" className="save-button" onClick={submitBugReport}>
              Submit report
            </button>
            {reportStatus && <p className="muted">{reportStatus}</p>}
          </div>
        </div>
        <div className="public-section">
          <div className="results-bar">
            <h3>Bug report updates</h3>
            <span className="pill">Your notifications</span>
          </div>
          <p className="muted">Resolved updates are archived after 3 days.</p>
          {reportUpdatesLoading ? (
            <p>Loading updates...</p>
          ) : reportUpdates.length === 0 ? (
            <p className="muted">No updates yet.</p>
          ) : (
            <div className="bug-report-list">
              {reportUpdates.map((item) => (
                <div className="bug-report-card" key={item.id}>
                  <div>
                    <h4>{item.title}</h4>
                    <p className="muted">{item.message || "Report update available."}</p>
                  </div>
                  <div className="bug-report-meta">
                    <span className="pill">{item.status || "resolved"}</span>
                    <span className="muted">
                      {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {isOwner && (
          <div className="public-section">
            <div className="results-bar">
              <h3>Incoming bug reports</h3>
              <span className="pill">Owner inbox</span>
            </div>
            {archiveStatus && <p className="muted">{archiveStatus}</p>}
            {reportsLoading ? (
              <p>Loading reports...</p>
            ) : reports.length === 0 ? (
              <p className="muted">No reports yet.</p>
            ) : (
              <div className="bug-report-list">
                {reports
                  .filter((item) => item.status !== "resolved")
                  .map((item) => (
                  <div className="bug-report-card" key={item.id}>
                    <div>
                      <h4>{item.title}</h4>
                      <p className="muted">{item.details}</p>
                      {item.steps && <p className="muted">Steps: {item.steps}</p>}
                    </div>
                    <div className="bug-report-meta">
                      <span className="pill">{item.type || "Bug"}</span>
                      <span className="pill">{item.severity || "Medium"}</span>
                      <span className="muted">{item.reporterName || "Anonymous"}</span>
                      <span className="muted">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                    <div className="bug-report-actions">
                      <button type="button" className="save-button" onClick={() => resolveReport(item)}>
                        Mark resolved
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!OWNER_UID && (
          <p className="muted">
            Owner inbox is disabled. Set <code>REACT_APP_OWNER_UID</code> in your
            environment to view incoming reports.
          </p>
        )}
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
                <Link
                  className="public-activity-card"
                  key={item.id}
                  to={`/discussion/${item.id}`}
                  state={{ from: "/profile" }}
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

export default Profile;
