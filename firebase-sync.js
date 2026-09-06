import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, runTransaction, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const setStatus = (text, online = false, stateName = online ? "saved" : "error", savedAt = "") => {
  document.getElementById("sync-dot-indicator")?.classList.toggle("online", online);
  const label = document.getElementById("sync-text-status");
  if (label) label.textContent = text;
  const badge = document.getElementById("sync-status-badge");
  if (badge) badge.dataset.state = stateName;
  const time = document.getElementById("sync-saved-at");
  if (time) time.textContent = savedAt ? `${new Date(savedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 保存` : "";
};

window.setAppSaveStatus = (text, stateName = "dirty") => setStatus(text, stateName === "saved", stateName);

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
let lastSyncedPayload = null;
let pendingRemotePayload = null;
let pendingSaveCount = 0;
let saveQueue = Promise.resolve();
let initialCloudStateLoaded = false;

const syncFields = [
  "schedule",
  "news",
  "rosters",
  "activityLog",
  "seasonArchive",
  "seasonInfo",
  "regulations"
];

const cloneData = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const currentStatePayload = () => Object.fromEntries(syncFields.map(field => [field, cloneData(state[field])]));
function mergeArrayById(remoteItems, localItems, baseItems, idKey) {
  if (!Array.isArray(remoteItems) || !Array.isArray(localItems) || !Array.isArray(baseItems)) return localItems;
  const baseById = new Map(baseItems.map(item => [item?.[idKey], item]));
  const localById = new Map(localItems.map(item => [item?.[idKey], item]));
  const localChanged = new Set(localItems
    .filter(item => !sameData(item, baseById.get(item?.[idKey])))
    .map(item => item?.[idKey]));
  const deleted = new Set(baseItems
    .filter(item => item?.[idKey] && !localById.has(item[idKey]))
    .map(item => item[idKey]));
  const remoteIds = new Set(remoteItems.map(item => item?.[idKey]));
  const additions = localItems.filter(item => item?.[idKey] && !remoteIds.has(item[idKey]));

  return [
    ...additions,
    ...remoteItems
      .filter(item => !deleted.has(item?.[idKey]))
      .map(item => localChanged.has(item?.[idKey]) ? localById.get(item[idKey]) : item)
  ];
}

function mergeObjectByKey(remoteValue, localValue, baseValue) {
  if (!remoteValue || !localValue || !baseValue || typeof remoteValue !== "object" || typeof localValue !== "object" || typeof baseValue !== "object") {
    return localValue;
  }
  const keys = new Set([...Object.keys(remoteValue), ...Object.keys(localValue), ...Object.keys(baseValue)]);
  const merged = {};
  keys.forEach(key => {
    const localHasKey = Object.prototype.hasOwnProperty.call(localValue, key);
    const baseHasKey = Object.prototype.hasOwnProperty.call(baseValue, key);
    const remoteHasKey = Object.prototype.hasOwnProperty.call(remoteValue, key);
    const localChanged = localHasKey !== baseHasKey || !sameData(localValue[key], baseValue[key]);
    if (localChanged && localHasKey) merged[key] = localValue[key];
    else if (localChanged && !localHasKey) return;
    else if (remoteHasKey) merged[key] = remoteValue[key];
  });
  return merged;
}

function mergeRosterMap(remoteValue = {}, localValue = {}, baseValue = {}) {
  const keys = new Set([
    ...Object.keys(remoteValue || {}),
    ...Object.keys(localValue || {}),
    ...Object.keys(baseValue || {})
  ]);
  const merged = {};
  keys.forEach(teamId => {
    const remoteRoster = Array.isArray(remoteValue?.[teamId]) ? remoteValue[teamId] : [];
    const localRoster = Array.isArray(localValue?.[teamId]) ? localValue[teamId] : [];
    const baseRoster = Array.isArray(baseValue?.[teamId]) ? baseValue[teamId] : [];
    merged[teamId] = mergeArrayById(remoteRoster, localRoster, baseRoster, "id");
  });
  return merged;
}

function mergeActivityLog(remoteItems, localItems) {
  const seen = new Set();
  return [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(remoteItems) ? remoteItems : [])]
    .filter(item => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

function mergeChangedField(field, remoteValue, localValue, baseValue) {
  if (field === "schedule") return mergeArrayById(remoteValue, localValue, baseValue, "id");
  if (field === "news") return mergeArrayById(remoteValue, localValue, baseValue, "id");
  if (field === "seasonArchive") return mergeArrayById(remoteValue, localValue, baseValue, "id");
  if (field === "rosters") return mergeRosterMap(remoteValue, localValue, baseValue);
  if (field === "activityLog") return mergeActivityLog(remoteValue, localValue);
  return localValue;
}

function applyRemoteState(remote) {
  applyingRemote = true;
  if (Array.isArray(remote.schedule)) state.schedule = remote.schedule;
  if (Array.isArray(remote.news)) state.news = remote.news;
  if (remote.rosters && typeof remote.rosters === "object") state.rosters = remote.rosters;
  if (Array.isArray(remote.activityLog)) state.activityLog = remote.activityLog;
  if (Array.isArray(remote.seasonArchive)) state.seasonArchive = remote.seasonArchive;
  if (remote.seasonInfo && typeof remote.seasonInfo === "object") state.seasonInfo = remote.seasonInfo;
  if (remote.regulations && typeof remote.regulations === "object") state.regulations = remote.regulations;
  state.lastSavedAt = remote.updatedAt || state.lastSavedAt;
  window.normalizeFnlTeamNames?.();
  state.standingsDirty = true;
  lastSyncedPayload = currentStatePayload();
  saveStateToStorage();
  refreshAllViews();
  applyingRemote = false;
  setStatus("保存済み", true, "saved", remote.updatedAt || new Date().toISOString());
}

function startListening() {
  unsubscribe?.();
  unsubscribe = onSnapshot(leagueRef, (snapshot) => {
    if (!snapshot.exists()) {
      lastSyncedPayload = currentStatePayload();
      initialCloudStateLoaded = true;
      setStatus("保存準備完了", true, "saved");
      return;
    }
    const remote = snapshot.data();
    initialCloudStateLoaded = true;
    pendingRemotePayload = remote;
    if (pendingSaveCount) return;
    applyRemoteState(remote);
  }, (error) => {
    console.error("Firestore listener failed", error);
    setStatus("同期エラー", false);
  });
}

state.dbSaveFn = () => {
  if (applyingRemote) return Promise.resolve();
  if (!initialCloudStateLoaded || !lastSyncedPayload) {
    return Promise.reject(new Error("クラウドの最新データを読み込み中です。数秒待ってからもう一度保存してください。"));
  }
  const localPayload = currentStatePayload();
  const basePayload = lastSyncedPayload ? cloneData(lastSyncedPayload) : null;
  pendingSaveCount += 1;
  setStatus("保存中", true, "saving");
  const save = async () => {
    if (!auth.currentUser) await signInAnonymously(auth);
    const changedFields = basePayload
      ? syncFields.filter(field => !sameData(localPayload[field], basePayload[field]))
      : syncFields;
    if (!changedFields.length) {
      setStatus("保存済み", true, "saved", state.lastSavedAt || new Date().toISOString());
      return;
    }
    const updatedAt = new Date().toISOString();
    state.lastSavedAt = updatedAt;
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(leagueRef);
      const remote = snapshot.exists() ? snapshot.data() : {};
      const patch = Object.fromEntries(changedFields.map(field => [
        field,
        mergeChangedField(field, remote[field], localPayload[field], basePayload?.[field])
      ]));
      const proposedRemote = { ...remote, ...patch };
      const validation = window.validateFnlPayload?.(proposedRemote, changedFields, remote);
      if (validation && !validation.valid) {
        throw new Error(`保存を中止しました。\n${validation.errors.join("\n")}`);
      }
      transaction.set(leagueRef, { ...patch, updatedAt, serverUpdatedAt: serverTimestamp() }, { merge: true });
    });
    setStatus("保存済み", true, "saved", updatedAt);
  };
  const queuedSave = saveQueue.then(save, save);
  saveQueue = queuedSave.catch(() => {});
  return queuedSave.catch(error => {
    setStatus("保存失敗", false, "error");
    throw error;
  }).finally(() => {
    pendingSaveCount -= 1;
    if (!pendingSaveCount && pendingRemotePayload) {
      const remote = pendingRemotePayload;
      pendingRemotePayload = null;
      applyRemoteState(remote);
    }
  });
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    setStatus("読み込み中", true, "saving");
    startListening();
  }
});

try {
  await signInAnonymously(auth);
} catch (error) {
  console.error("Anonymous authentication failed", error);
  setStatus("認証エラー", false);
}
