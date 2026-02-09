const admin = require("firebase-admin");
const functions = require("firebase-functions/v2");

admin.initializeApp();

const db = admin.firestore();

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

