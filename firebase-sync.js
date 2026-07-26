import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const setStatus = (text, online = false) => {
  document.getElementById("sync-dot-indicator")?.classList.toggle("online", online);
  const label = document.getElementById("sync-text-status");
  if (label) label.textContent = text;
};

const config = window.FNL_FIREBASE_CONFIG;
if (!config?.apiKey) {
  setStatus("Firebase 設定エラー");
  throw new Error("Missing FNL_FIREBASE_CONFIG");
}

const app = getApps().length ? getApp() : initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const leagueRef = doc(db, "shared", window.FNL_FIREBASE_APP_ID || "fnl-season1");
let applyingRemote = false;
let unsubscribe;

function startListening() {
  unsubscribe?.();
  unsubscribe = onSnapshot(leagueRef, (snapshot) => {
    if (!snapshot.exists()) {
      setStatus("クラウド同期準備完了", true);
      return;
    }
    const remote = snapshot.data();
    const remoteUpdatedAt = remote.updatedAt || "";
    if (state.lastSavedAt && remoteUpdatedAt && remoteUpdatedAt < state.lastSavedAt) return;

    applyingRemote = true;
    if (Array.isArray(remote.schedule)) state.schedule = remote.schedule;
    if (Array.isArray(remote.news)) state.news = remote.news;
    if (remote.rosters && typeof remote.rosters === "object") state.rosters = remote.rosters;
    if (remote.transferMarket && typeof remote.transferMarket === "object") state.transferMarket = remote.transferMarket;
    if (Array.isArray(remote.activityLog)) state.activityLog = remote.activityLog;
    if (Array.isArray(remote.seasonArchive)) state.seasonArchive = remote.seasonArchive;
    if (remote.seasonInfo && typeof remote.seasonInfo === "object") state.seasonInfo = remote.seasonInfo;
    if (Object.prototype.hasOwnProperty.call(remote, "previousSeasonSnapshot")) state.previousSeasonSnapshot = remote.previousSeasonSnapshot;
    if (Object.prototype.hasOwnProperty.call(remote, "lastMatchSnapshot")) state.lastMatchSnapshot = remote.lastMatchSnapshot;
    state.lastSavedAt = remoteUpdatedAt || state.lastSavedAt;
    state.standingsDirty = true;
    saveStateToStorage();
    refreshAllViews();
    renderNews();
    renderTransferCenter?.();
    applyingRemote = false;
    setStatus("クラウド同期済み", true);
  }, (error) => {
    console.error("Firestore listener failed", error);
    setStatus("同期エラー", false);
  });
}

state.dbSaveFn = async () => {
  if (applyingRemote) return;
  const updatedAt = new Date().toISOString();
  state.lastSavedAt = updatedAt;
  saveStateToStorage();
  if (!auth.currentUser) await signInAnonymously(auth);
  await setDoc(leagueRef, {
    schedule: state.schedule,
    news: state.news,
    rosters: state.rosters,
    transferMarket: state.transferMarket,
    activityLog: state.activityLog,
    seasonArchive: state.seasonArchive,
    seasonInfo: state.seasonInfo,
    previousSeasonSnapshot: state.previousSeasonSnapshot,
    lastMatchSnapshot: state.lastMatchSnapshot,
    updatedAt,
    serverUpdatedAt: serverTimestamp()
  }, { merge: true });
  setStatus("クラウド同期済み", true);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    setStatus("クラウド同期中", true);
    startListening();
  }
});

try {
  await signInAnonymously(auth);
} catch (error) {
  console.error("Anonymous authentication failed", error);
  setStatus("認証エラー", false);
}
