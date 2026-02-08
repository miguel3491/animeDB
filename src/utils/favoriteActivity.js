import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

const clampText = (value, max = 140) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export async function logFavoriteActivity(uid, event) {
  if (!uid) return;
  try {
    const payload = {
      createdAt: serverTimestamp(),
      clientAt: new Date().toISOString(),
      category: "favorites",
      action: String(event?.action || "updated"),
      mediaType: String(event?.mediaType || "anime"),
      itemKey: String(event?.itemKey || ""),
      mal_id: typeof event?.mal_id === "number" ? event.mal_id : Number(event?.mal_id) || null,
      title: clampText(event?.title || "Untitled", 140),
      image: String(event?.image || ""),
      status: event?.status ? String(event.status) : "",
      details: event?.details ? clampText(event.details, 200) : ""
    };

    // Drop very low-value events.
    if (!payload.itemKey && !payload.mal_id && !payload.title) return;

    await addDoc(collection(db, "users", uid, "favoriteActivity"), payload);
  } catch (err) {
    // Activity is best-effort; failures shouldn't block the main UX.
  }
}
