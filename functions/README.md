# Inbox Cleanup (Firebase Functions)

This app writes notifications to Firestore under `users/{uid}/inboxEvents/{eventId}`.
To prevent unbounded growth (cost + performance), deploy the scheduled function in `functions/index.js`.

## What It Does

- Deletes `seen == true` inbox events after **14 days**
- Deletes `seen == false` inbox events after **90 days** (safety net)

The cleanup uses the `clientAt` ISO string field for cutoffs.

## Deploy

1. Install Firebase CLI (once):
   - `npm i -g firebase-tools`
2. Login:
   - `firebase login`
3. In this repo:
   - `cd functions`
   - `npm i`
4. Select the correct project (if needed):
   - `firebase use animedb-695e9`
5. Deploy functions:
   - `firebase deploy --only functions`

## Index Note

Firestore may prompt you to create a composite index for the collection group query on:
- `inboxEvents` with fields `seen` and `clientAt`

If you see an index error in the Functions logs, click the provided link to create it.

