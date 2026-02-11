import {
  collection,
  doc,
  documentId,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAt
} from "firebase/firestore";
import { db } from "../firebase";

const profileCache = new Map(); // uid -> { username, avatar } | null
const profileInflight = new Map(); // uid -> Promise
const handleCache = new Map(); // handle -> { handle, uid, username, avatar }
const handleInflight = new Map(); // handle -> Promise
const searchCache = new Map(); // prefix:max -> [{handle,uid,username,avatar}]
const searchInflight = new Map(); // prefix:max -> Promise

const normalizeHandle = (handle) => String(handle || "").trim().replace(/^@/, "").toLowerCase();

export const extractMentionHandles = (text, max = 5) => {
  const raw = String(text || "");
  const out = new Set();
  const re = /@([a-zA-Z0-9_]{3,30})/g;
  let match;
  while ((match = re.exec(raw))) {
    const handle = normalizeHandle(match[1]);
    if (!handle) continue;
    out.add(handle);
    if (out.size >= max) break;
  }
  return Array.from(out);
};

const fetchProfile = async (uidRaw) => {
  const uid = String(uidRaw || "").trim();
  if (!uid) return null;
  if (profileCache.has(uid)) return profileCache.get(uid);
  if (profileInflight.has(uid)) return profileInflight.get(uid);

  const task = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        profileCache.set(uid, null);
        return null;
      }
      const data = snap.data() || {};
      const payload = {
        username: String(data.username || "").trim(),
        avatar: String(data.avatar || "").trim()
      };
      profileCache.set(uid, payload);
      return payload;
    } catch (err) {
      profileCache.set(uid, null);
      return null;
    } finally {
      profileInflight.delete(uid);
    }
  })();

  profileInflight.set(uid, task);
  return task;
};

export const resolveMentionHandle = async (handleRaw) => {
  const handle = normalizeHandle(handleRaw);
  if (!handle) return null;
  if (handleCache.has(handle)) return handleCache.get(handle);
  if (handleInflight.has(handle)) return handleInflight.get(handle);

  const task = (async () => {
    try {
      const snap = await getDoc(doc(db, "usernames", handle));
      const uid = snap.exists() ? String(snap.data()?.uid || "").trim() : "";
      if (!uid) {
        const payload = { handle, uid: "", username: "", avatar: "" };
        handleCache.set(handle, payload);
        return payload;
      }
      const prof = await fetchProfile(uid);
      const payload = {
        handle,
        uid,
        username: String(prof?.username || "").trim(),
        avatar: String(prof?.avatar || "").trim()
      };
      handleCache.set(handle, payload);
      return payload;
    } catch (err) {
      const payload = { handle, uid: "", username: "", avatar: "" };
      handleCache.set(handle, payload);
      return payload;
    } finally {
      handleInflight.delete(handle);
    }
  })();

  handleInflight.set(handle, task);
  return task;
};

export const resolveHandlesToUids = async (handles) => {
  const list = Array.isArray(handles) ? handles : [];
  const resolved = await Promise.all(list.map((h) => resolveMentionHandle(h)));
  const out = [];
  resolved.forEach((item) => {
    const uid = String(item?.uid || "").trim();
    if (!uid) return;
    out.push(uid);
  });
  return Array.from(new Set(out));
};

export const searchMentionUsers = async (prefixRaw, max = 6) => {
  const prefix = normalizeHandle(prefixRaw);
  if (!prefix) return [];
  const safeMax = Math.max(1, Math.min(10, Number(max) || 6));
  const key = `${prefix}:${safeMax}`;
  if (searchCache.has(key)) return searchCache.get(key);
  if (searchInflight.has(key)) return searchInflight.get(key);

  const task = (async () => {
    try {
      const ref = collection(db, "usernames");
      const q = query(
        ref,
        orderBy(documentId()),
        startAt(prefix),
        endAt(`${prefix}\uf8ff`),
        limit(safeMax)
      );
      const snap = await getDocs(q);
      const handles = snap.docs.map((d) => String(d.id || "").trim().toLowerCase()).filter(Boolean);
      const resolved = await Promise.all(handles.map((h) => resolveMentionHandle(h)));
      const rows = resolved.filter(Boolean).filter((m) => Boolean(m.uid));
      searchCache.set(key, rows);
      return rows;
    } catch (err) {
      searchCache.set(key, []);
      return [];
    } finally {
      searchInflight.delete(key);
    }
  })();

  searchInflight.set(key, task);
  return task;
};

export const getActiveMentionToken = (textRaw, cursorRaw) => {
  const text = String(textRaw || "");
  const cursor = Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : text.length;
  const safeCursor = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, safeCursor);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  const prev = at > 0 ? before.charAt(at - 1) : "";
  if (prev && /[A-Za-z0-9_]/.test(prev)) return null;
  const queryText = before.slice(at + 1);
  if (queryText.length > 30) return null;
  if (!/^[A-Za-z0-9_]*$/.test(queryText)) return null;
  return {
    atIndex: at,
    start: at + 1,
    end: safeCursor,
    query: normalizeHandle(queryText)
  };
};

export const applyMentionAutocomplete = (textRaw, cursorRaw, handleRaw) => {
  const text = String(textRaw || "");
  const token = getActiveMentionToken(text, cursorRaw);
  const handle = normalizeHandle(handleRaw);
  if (!token || !handle) {
    return { text, cursor: Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : text.length, handle: "" };
  }
  const nextText = `${text.slice(0, token.start)}${handle} ${text.slice(token.end)}`;
  const nextCursor = token.start + handle.length + 1;
  return { text: nextText, cursor: nextCursor, handle };
};

