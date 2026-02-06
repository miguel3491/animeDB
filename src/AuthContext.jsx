import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

const AuthContext = createContext({
  user: null,
  loading: true,
  signIn: async () => {},
  signOutUser: async () => {},
  profile: null,
  profileLoading: true,
  updateProfile: async () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const generateName = () => {
    const adjectives = [
      "Cosmic",
      "Neon",
      "Lunar",
      "Stellar",
      "Crimson",
      "Azure",
      "Shadow",
      "Nova",
      "Turbo",
      "Quiet"
    ];
    const nouns = [
      "Ronin",
      "Kitsune",
      "Samurai",
      "Otaku",
      "Specter",
      "Comet",
      "Rider",
      "Drifter",
      "Cipher",
      "Voyager"
    ];
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    return `${pick(adjectives)} ${pick(nouns)} ${Math.floor(100 + Math.random() * 900)}`;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      return undefined;
    }

    setProfileLoading(true);
    const profileRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(profileRef, (snapshot) => {
      const data = snapshot.data() || {};
      let nextProfile = data;

      if (!snapshot.exists() || !data.username) {
        const username = data.username || generateName();
        nextProfile = {
          username,
          avatar: data.avatar || "",
          background: data.background || "",
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const usernameRef = doc(db, "usernames", username.toLowerCase());
        setDoc(profileRef, nextProfile, { merge: true });
        setDoc(usernameRef, { uid: user.uid }, { merge: true });
      }

      setProfile(nextProfile);
      setProfileLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signOutUser = async () => {
    await signOut(auth);
  };

  const updateProfile = async (updates) => {
    if (!user) return;
    const profileRef = doc(db, "users", user.uid);
    if (updates.username) {
      const candidate = updates.username.trim();
      const usernameRef = doc(db, "usernames", candidate.toLowerCase());
      const existing = await getDoc(usernameRef);
      if (existing.exists() && existing.data()?.uid !== user.uid) {
        throw new Error("Username already taken.");
      }
      await setDoc(usernameRef, { uid: user.uid }, { merge: true });
      updates.username = candidate;
    }
    await setDoc(
      profileRef,
      {
        ...updates,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signOutUser, profile, profileLoading, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
