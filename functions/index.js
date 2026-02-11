const admin = require("firebase-admin");
const functions = require("firebase-functions/v2");
const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const isoDaysAgo = (days) => {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
};

const deleteQueryInBatches = async (query, batchSize = 400) => {
  let deleted = 0;
  while (true) {
    const snap = await query.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((docItem) => batch.delete(docItem.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
};

// Daily cleanup for inbox notifications so per-user inboxEvents don't grow unbounded.
// Policy:
// - Delete seen events after 14 days.
// - Delete unseen events after 90 days (safety net).
// Notes:
// - We use clientAt (ISO string) for cutoffs because legacy docs may have createdAt stored as a string.
// - Firestore may require a composite index on (seen, clientAt) for this collectionGroup query.
exports.cleanupInboxEvents = functions.scheduler.onSchedule(
  { schedule: "every day 03:15", timeZone: "America/New_York" },
  async () => {
    const seenCutoff = isoDaysAgo(14);
    const unseenCutoff = isoDaysAgo(90);

    const group = db.collectionGroup("inboxEvents");

    const seenQuery = group
      .where("seen", "==", true)
      .where("clientAt", "<", seenCutoff)
      .orderBy("clientAt", "asc");

    const unseenQuery = group
      .where("seen", "==", false)
      .where("clientAt", "<", unseenCutoff)
      .orderBy("clientAt", "asc");

    const seenDeleted = await deleteQueryInBatches(seenQuery, 350);
    const unseenDeleted = await deleteQueryInBatches(unseenQuery, 350);

    if (seenDeleted || unseenDeleted) {
      console.log("cleanupInboxEvents deleted", { seenDeleted, unseenDeleted });
    }
  }
);

// Maintain public counters on users/{uid} without weakening Firestore rules.
// These are used by PublicProfile to display follower count and group count.
exports.syncFollowerCountOnCreate = onDocumentCreated("users/{uid}/followers/{followerId}", async (event) => {
  const uid = event.params.uid;
  if (!uid) return;
  await db.doc(`users/${uid}`).set({ followerCount: FieldValue.increment(1) }, { merge: true });
});

exports.syncFollowerCountOnDelete = onDocumentDeleted("users/{uid}/followers/{followerId}", async (event) => {
  const uid = event.params.uid;
  if (!uid) return;
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? Number(snap.data()?.followerCount || 0) : 0;
    const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) - 1);
    tx.set(ref, { followerCount: next }, { merge: true });
  });
});

exports.syncGroupCountOnMemberCreate = onDocumentCreated("groups/{groupId}/members/{uid}", async (event) => {
  const uid = event.params.uid;
  if (!uid) return;
  await db.doc(`users/${uid}`).set({ groupCount: FieldValue.increment(1) }, { merge: true });
});

exports.syncGroupCountOnMemberDelete = onDocumentDeleted("groups/{groupId}/members/{uid}", async (event) => {
  const uid = event.params.uid;
  if (!uid) return;
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? Number(snap.data()?.groupCount || 0) : 0;
    const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) - 1);
    tx.set(ref, { groupCount: next }, { merge: true });
  });
});

// Maintain a public (privacy-safe) index of groups a user belongs to:
// users/{uid}/publicGroups/{groupId}
// This lets PublicProfile show public groups without needing to read groups/*/members (which leaks rosters).
exports.syncPublicGroupsIndexOnMemberCreate = onDocumentCreated("groups/{groupId}/members/{uid}", async (event) => {
  const uid = event.params.uid;
  const groupId = event.params.groupId;
  if (!uid || !groupId) return;

  try {
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists) return;
    const isPublic = groupSnap.data()?.isPublic === true;
    if (!isPublic) return;

    const memberData = event.data?.data?.() || {};
    const joinedAt = typeof memberData.joinedAt === "string" ? memberData.joinedAt : new Date().toISOString();
    await db.doc(`users/${uid}/publicGroups/${groupId}`).set(
      {
        groupId,
        joinedAt
      },
      { merge: true }
    );
  } catch (err) {
    console.log("syncPublicGroupsIndexOnMemberCreate failed", { uid, groupId, message: err?.message });
  }
});

exports.syncPublicGroupsIndexOnMemberDelete = onDocumentDeleted("groups/{groupId}/members/{uid}", async (event) => {
  const uid = event.params.uid;
  const groupId = event.params.groupId;
  if (!uid || !groupId) return;
  try {
    await db.doc(`users/${uid}/publicGroups/${groupId}`).delete();
  } catch (err) {
    console.log("syncPublicGroupsIndexOnMemberDelete failed", { uid, groupId, message: err?.message });
  }
});

// Maintain a best-effort memberCount on groups/{groupId}.
// This avoids letting clients update group docs (simpler and safer Firestore rules).
exports.syncGroupMemberCountOnCreate = onDocumentCreated("groups/{groupId}/members/{uid}", async (event) => {
  const groupId = event.params.groupId;
  if (!groupId) return;
  const nowIso = new Date().toISOString();
  try {
    await db.doc(`groups/${groupId}`).set(
      {
        memberCount: FieldValue.increment(1),
        updatedAt: nowIso,
        updatedAtTs: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (err) {
    console.log("syncGroupMemberCountOnCreate failed", { groupId, message: err?.message });
  }
});

exports.syncGroupMemberCountOnDelete = onDocumentDeleted("groups/{groupId}/members/{uid}", async (event) => {
  const groupId = event.params.groupId;
  if (!groupId) return;
  const nowIso = new Date().toISOString();
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`groups/${groupId}`);
      const snap = await tx.get(ref);
      const cur = snap.exists ? Number(snap.data()?.memberCount || 0) : 0;
      const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) - 1);
      tx.set(
        ref,
        {
          memberCount: next,
          updatedAt: nowIso,
          updatedAtTs: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
  } catch (err) {
    console.log("syncGroupMemberCountOnDelete failed", { groupId, message: err?.message });
  }
});

// Auto-delete groups when they have zero members and notify the owner via Inbox.
// This must be server-side because the last member leaving cannot be relied on to run client logic.
exports.autoDeleteGroupWhenEmpty = onDocumentDeleted("groups/{groupId}/members/{uid}", async (event) => {
  const groupId = event.params.groupId;
  if (!groupId) return;

  const groupRef = db.doc(`groups/${groupId}`);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) return; // already deleted (or deleting)

  // Verify the roster is truly empty to avoid deleting due to stale memberCount or race conditions.
  const membersSnap = await groupRef.collection("members").limit(1).get();
  if (!membersSnap.empty) return;

  const data = groupSnap.data() || {};
  const ownerId = data.ownerId || "";
  const groupName = data.name || "Unnamed group";
  const nowIso = new Date().toISOString();

  try {
    if (ownerId) {
      await db.collection(`users/${ownerId}/inboxEvents`).add({
        type: "groupEliminated",
        seen: false,
        clientAt: nowIso,
        createdAt: FieldValue.serverTimestamp(),
        toUid: ownerId,
        fromUid: "system",
        fromName: "AniKumo",
        fromAvatar: "",
        groupId,
        groupName,
        excerpt: "Group was eliminated because it had 0 members."
      });
    }
  } catch (err) {
    console.log("autoDeleteGroupWhenEmpty notify failed", { groupId, ownerId, message: err?.message });
    // continue to deletion attempt even if notification fails
  }

  try {
    if (typeof db.recursiveDelete === "function") {
      await db.recursiveDelete(groupRef);
      return;
    }
  } catch (err) {
    // fall through to manual deletion
  }

  // Manual fallback if recursiveDelete isn't available.
  try {
    // Delete posts and their subcollections first.
    const postsRef = groupRef.collection("posts");
    while (true) {
      const postsSnap = await postsRef.limit(25).get();
      if (postsSnap.empty) break;
      for (const postDoc of postsSnap.docs) {
        const postRef = postDoc.ref;
        await deleteQueryInBatches(postRef.collection("comments"), 350);
        await deleteQueryInBatches(postRef.collection("pendingComments"), 350);
        await deleteQueryInBatches(postRef.collection("likes"), 350);
        await postRef.delete();
      }
    }

    // Delete any remaining members (should already be empty) and the group doc itself.
    await deleteQueryInBatches(groupRef.collection("members"), 350);
    await groupRef.delete();
  } catch (err) {
    console.log("autoDeleteGroupWhenEmpty delete failed", { groupId, message: err?.message });
  }
});

// Cascade delete group post subcollections so "delete post" removes its thread.
exports.cascadeDeleteGroupPost = onDocumentDeleted("groups/{groupId}/posts/{postId}", async (event) => {
  const groupId = event.params.groupId;
  const postId = event.params.postId;
  if (!groupId || !postId) return;
  const postRef = db.doc(`groups/${groupId}/posts/${postId}`);
  try {
    // recursiveDelete is available in newer admin SDKs. Fall back to batch deletes if missing.
    if (typeof db.recursiveDelete === "function") {
      await db.recursiveDelete(postRef.collection("comments"));
      await db.recursiveDelete(postRef.collection("pendingComments"));
      await db.recursiveDelete(postRef.collection("likes"));
      return;
    }
  } catch (err) {
    // fall through to manual deletion
  }

  try {
    const comments = postRef.collection("comments").orderBy("createdAt", "asc");
    const pending = postRef.collection("pendingComments").orderBy("createdAt", "asc");
    const likes = postRef.collection("likes").orderBy("createdAt", "asc");
    const commentsDeleted = await deleteQueryInBatches(comments, 350);
    const pendingDeleted = await deleteQueryInBatches(pending, 350);
    const likesDeleted = await deleteQueryInBatches(likes, 350);
    if (commentsDeleted || pendingDeleted || likesDeleted) {
      console.log("cascadeDeleteGroupPost deleted", { groupId, postId, commentsDeleted, pendingDeleted, likesDeleted });
    }
  } catch (err) {
    console.log("cascadeDeleteGroupPost failed", { groupId, postId, message: err?.message });
  }
});

// Maintain likeCount on group posts.
// Clients are not allowed to update likeCount directly (rules restrict post updates),
// so we derive it from likes/{uid} docs.
exports.syncGroupPostLikeCountOnCreate = onDocumentCreated("groups/{groupId}/posts/{postId}/likes/{uid}", async (event) => {
  const groupId = event.params.groupId;
  const postId = event.params.postId;
  if (!groupId || !postId) return;
  try {
    await db.doc(`groups/${groupId}/posts/${postId}`).set(
      { likeCount: FieldValue.increment(1) },
      { merge: true }
    );
  } catch (err) {
    console.log("syncGroupPostLikeCountOnCreate failed", { groupId, postId, message: err?.message });
  }
});

exports.syncGroupPostLikeCountOnDelete = onDocumentDeleted("groups/{groupId}/posts/{postId}/likes/{uid}", async (event) => {
  const groupId = event.params.groupId;
  const postId = event.params.postId;
  if (!groupId || !postId) return;
  const ref = db.doc(`groups/${groupId}/posts/${postId}`);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const cur = Number(snap.data()?.likeCount || 0);
      const next = Math.max(0, (Number.isFinite(cur) ? cur : 0) - 1);
      tx.set(ref, { likeCount: next }, { merge: true });
    });
  } catch (err) {
    console.log("syncGroupPostLikeCountOnDelete failed", { groupId, postId, message: err?.message });
  }
});
