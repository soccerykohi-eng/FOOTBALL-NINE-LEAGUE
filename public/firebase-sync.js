import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, runTransaction, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";

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
const notificationConfig = window.FNL_NOTIFICATION_CONFIG || {};
const notificationEnabledKey = "fnl-news-notifications-enabled";
const notificationTokenKey = "fnl-news-notification-token";
let applyingRemote = false;
let unsubscribe;
let messaging;
let foregroundListenerBound = false;
let lastSyncedPayload = null;
let pendingRemotePayload = null;
let pendingSaveCount = 0;
let saveQueue = Promise.resolve();
let initialCloudStateLoaded = false;

const syncFields = [
  "schedule",
  "news",
  "rosters",
  "transferMarket",
  "activityLog",
  "seasonArchive",
  "seasonInfo",
  "regulations",
  "hirabayashiCup",
  "previousSeasonSnapshot",
  "lastMatchSnapshot"
];

const cloneData = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sameData = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const currentStatePayload = () => Object.fromEntries(syncFields.map(field => [field, cloneData(state[field])]));
const cloudRecoveryKey = "fnl-cloud-recovery-v1";
const partialLeagueRecoveryKey = "fnl-season1-partial-recovery-20260812-v5";

async function recoverConfirmedSeasonOneResults() {
  if (localStorage.getItem(partialLeagueRecoveryKey) === "done") return;
  if (!initialCloudStateLoaded || !lastSyncedPayload || Number(state.seasonInfo?.number || 1) !== 1) return;
  const confirmed = {
    m_61: [1, 3],
    m_63: [2, 1],
    m_64: [0, 1],
    m_65: [1, 2],
    m_66: [5, 1],
    m_67: [0, 3],
    m_68: [1, 0],
    m_69: [4, 2],
    m_70: [3, 4],
    m_71: [2, 7],
    m_72: [6, 1]
  };
  const restored = [];
  state.schedule.forEach(match => {
    const score = confirmed[match.id];
    if (!score || match.hs !== null || match.as !== null) return;
    match.hs = score[0];
    match.as = score[1];
    restored.push(match.id);
  });
  if (!restored.length) {
    localStorage.setItem(partialLeagueRecoveryKey, "done");
    return;
  }
  state.standingsDirty = true;
  saveStateToStorage();
  refreshAllViews();
  try {
    await state.dbSaveFn();
    localStorage.setItem(partialLeagueRecoveryKey, "done");
    setStatus("試合結果を復元しました", true);
  } catch (error) {
    console.error("Confirmed match recovery failed", error);
    setStatus("試合結果の復元を再試行します", false);
  }
}

function storeCloudRecoverySnapshot(remote) {
  if (!remote || !Array.isArray(remote.schedule)) return;
  try {
    const existing = JSON.parse(localStorage.getItem(cloudRecoveryKey) || "[]");
    const marker = remote.updatedAt || remote.serverUpdatedAt?.toDate?.()?.toISOString?.() || "";
    if (existing[0]?.marker === marker && marker) return;
    const payload = Object.fromEntries(syncFields.map(field => [field, cloneData(remote[field])]));
    const cloudBackup = remote.scheduleBackup?.schedule ? {
      marker: `cloud-backup-${remote.scheduleBackup.backedUpAt || "latest"}`,
      savedAt: remote.scheduleBackup.backedUpAt || new Date().toISOString(),
      payload: { ...payload, schedule: cloneData(remote.scheduleBackup.schedule), seasonInfo: cloneData(remote.scheduleBackup.seasonInfo || payload.seasonInfo) }
    } : null;
    const next = [{ marker, savedAt: new Date().toISOString(), payload }, ...(cloudBackup ? [cloudBackup] : []), ...existing]
      .filter((item, index, items) => items.findIndex(candidate => candidate.marker === item.marker) === index)
      .slice(0, 10);
    localStorage.setItem(cloudRecoveryKey, JSON.stringify(next));
  } catch (error) {
    console.warn("Cloud recovery snapshot could not be stored", error);
  }
}

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
  if (field === "rosters") return mergeObjectByKey(remoteValue, localValue, baseValue);
  if (field === "activityLog") return mergeActivityLog(remoteValue, localValue);
  return localValue;
}

const setNotificationUI = (text, enabled = false, unavailable = false) => {
  const button = document.getElementById("news-notification-button");
  const note = document.getElementById("news-notification-note");
  if (button) {
    button.textContent = enabled ? "通知を停止" : "通知を受け取る";
    button.disabled = unavailable;
  }
  if (note) note.textContent = text;
};

const callNotificationWorker = async (path, payload) => {
  if (!notificationConfig.workerUrl) throw new Error("通知サーバーが未設定です");
  const response = await fetch(`${notificationConfig.workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "通知サーバーとの通信に失敗しました");
  return result;
};

const getNewsMessaging = async () => {
  if (!(await isSupported())) throw new Error("この端末はWeb通知に対応していません");
  if (!messaging) messaging = getMessaging(app);
  return messaging;
};

const subscribeNewsNotifications = async ({ silent = false } = {}) => {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    setNotificationUI("この端末またはブラウザはニュース通知に対応していません。", false, true);
    if (!silent) alert("この端末またはブラウザは通知に対応していません。");
    return false;
  }
  if (!notificationConfig.vapidKey) {
    setNotificationUI("ニュース通知は現在、最終設定中です。", false, true);
    if (!silent) alert("ニュース通知は現在、最終設定中です。");
    return false;
  }

  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isAppleMobile && !isStandalone) {
    setNotificationUI("iPhone・iPadではホーム画面に追加したFNLアプリから通知を有効にしてください。");
    if (!silent) alert("Safariの共有メニューから「ホーム画面に追加」し、追加したFNLアプリで通知を有効にしてください。");
    return false;
  }

  let permission = Notification.permission;
  if (permission === "default" && !silent) permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setNotificationUI(permission === "denied" ? "通知が拒否されています。端末の設定から許可してください。" : "ニュースが公開されたときだけ通知します。");
    return false;
  }

  const messagingInstance = await getNewsMessaging();
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messagingInstance, {
    vapidKey: notificationConfig.vapidKey,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error("通知用の端末情報を取得できませんでした");

  await callNotificationWorker("/subscribe", { token });
  localStorage.setItem(notificationEnabledKey, "true");
  localStorage.setItem(notificationTokenKey, token);
  setNotificationUI("ニュースが公開されたときだけ、この端末へ通知します。", true);

  if (!foregroundListenerBound) {
    foregroundListenerBound = true;
    onMessage(messagingInstance, async payload => {
      const title = payload.notification?.title || "FNL NEWS";
      const options = {
        body: payload.notification?.body || "新しいニュースが公開されました。",
        icon: "./fnl-logo.png",
        badge: "./fnl-logo.png",
        data: { url: "./" }
      };
      const activeRegistration = await navigator.serviceWorker.ready;
      activeRegistration.showNotification(title, options);
    });
  }
  return true;
};

const unsubscribeNewsNotifications = async () => {
  const token = localStorage.getItem(notificationTokenKey);
  if (token) {
    await callNotificationWorker("/unsubscribe", { token }).catch(error => console.warn("Notification unsubscribe failed", error));
  }
  if (messaging || await isSupported()) {
    try {
      const messagingInstance = messaging || getMessaging(app);
      await deleteToken(messagingInstance);
    } catch (error) {
      console.warn("Firebase notification token deletion failed", error);
    }
  }
  localStorage.removeItem(notificationEnabledKey);
  localStorage.removeItem(notificationTokenKey);
  setNotificationUI("ニュースが公開されたときだけ通知します。", false);
};

window.toggleNewsNotifications = async () => {
  const currentlyEnabled = localStorage.getItem(notificationEnabledKey) === "true";
  try {
    if (currentlyEnabled) {
      await unsubscribeNewsNotifications();
    } else {
      await subscribeNewsNotifications();
    }
  } catch (error) {
    console.error("Notification setting failed", error);
    setNotificationUI("通知設定に失敗しました。時間をおいてもう一度お試しください。");
    alert(error.message || "通知設定に失敗しました。");
  }
};

window.notifyNewsPublished = async newsId => {
  if (!newsId || !notificationConfig.workerUrl) return;
  try {
    await callNotificationWorker("/notify-news", { newsId });
  } catch (error) {
    console.error("News notification delivery failed", error);
  }
};

const initializeNewsNotifications = async () => {
  if (!notificationConfig.vapidKey) {
    setNotificationUI("ニュース通知は現在、最終設定中です。", false, true);
    return;
  }
  if (localStorage.getItem(notificationEnabledKey) !== "true") {
    setNotificationUI("ニュースが公開されたときだけ通知します。", false);
    return;
  }
  try {
    await subscribeNewsNotifications({ silent: true });
  } catch (error) {
    console.warn("Notification initialization failed", error);
    setNotificationUI("通知の再接続が必要です。「通知を受け取る」を押してください。");
    localStorage.removeItem(notificationEnabledKey);
  }
};

function applyRemoteState(remote) {
  applyingRemote = true;
  if (Array.isArray(remote.schedule)) state.schedule = remote.schedule;
  if (Array.isArray(remote.news)) state.news = remote.news;
  if (remote.rosters && typeof remote.rosters === "object") state.rosters = remote.rosters;
  if (remote.transferMarket && typeof remote.transferMarket === "object") state.transferMarket = remote.transferMarket;
  if (Array.isArray(remote.activityLog)) state.activityLog = remote.activityLog;
  if (Array.isArray(remote.seasonArchive)) state.seasonArchive = remote.seasonArchive;
  if (remote.seasonInfo && typeof remote.seasonInfo === "object") state.seasonInfo = remote.seasonInfo;
  if (remote.regulations && typeof remote.regulations === "object") state.regulations = remote.regulations;
  if (remote.hirabayashiCup && typeof remote.hirabayashiCup === "object") state.hirabayashiCup = remote.hirabayashiCup;
  if (Object.prototype.hasOwnProperty.call(remote, "previousSeasonSnapshot")) state.previousSeasonSnapshot = remote.previousSeasonSnapshot;
  if (Object.prototype.hasOwnProperty.call(remote, "lastMatchSnapshot")) state.lastMatchSnapshot = remote.lastMatchSnapshot;
  state.lastSavedAt = remote.updatedAt || state.lastSavedAt;
  window.normalizeFnlTeamNames?.();
  state.standingsDirty = true;
  lastSyncedPayload = currentStatePayload();
  saveStateToStorage();
  refreshAllViews();
  renderNews();
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
    storeCloudRecoverySnapshot(remote);
    pendingRemotePayload = remote;
    if (pendingSaveCount) return;
    applyRemoteState(remote);
    recoverConfirmedSeasonOneResults();
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
      storeCloudRecoverySnapshot(remote);
      if (basePayload && changedFields.includes("transferMarket") && !sameData(remote.transferMarket, basePayload.transferMarket)) {
        throw new Error("他の端末で移籍市場が更新されました。最新状態を読み込んでからもう一度操作してください。");
      }
      if (basePayload && changedFields.includes("hirabayashiCup") && !sameData(remote.hirabayashiCup, basePayload.hirabayashiCup)) {
        throw new Error("他の端末で平林杯が更新されました。最新状態を読み込んでからもう一度操作してください。");
      }
      if (remote.hirabayashiCup?.groupDraw?.locked && changedFields.includes("hirabayashiCup")) {
        const localCup = localPayload.hirabayashiCup || {};
        if (!sameData(localCup.groups, remote.hirabayashiCup.groups) || !sameData(localCup.groupDraw, remote.hirabayashiCup.groupDraw)) {
          throw new Error("平林杯のグループ組み合わせは確定済みのため変更できません。");
        }
      }
      if (basePayload && changedFields.includes("rosters")) {
        const teamIds = new Set([
          ...Object.keys(basePayload.rosters || {}),
          ...Object.keys(localPayload.rosters || {}),
          ...Object.keys(remote.rosters || {})
        ]);
        const conflictingTeam = [...teamIds].find(teamId =>
          !sameData(localPayload.rosters?.[teamId], basePayload.rosters?.[teamId])
          && !sameData(remote.rosters?.[teamId], basePayload.rosters?.[teamId])
        );
        if (conflictingTeam) throw new Error("他の端末で同じクラブの名簿が更新されました。最新状態を読み込んでからもう一度操作してください。");
      }
      const patch = Object.fromEntries(changedFields.map(field => [
        field,
        mergeChangedField(field, remote[field], localPayload[field], basePayload?.[field])
      ]));
      const proposedRemote = { ...remote, ...patch };
      const validation = window.validateFnlPayload?.(proposedRemote, changedFields, remote);
      if (validation && !validation.valid) {
        throw new Error(`保存を中止しました。\n${validation.errors.join("\n")}`);
      }
      const cloudScheduleBackup = snapshot.exists() && changedFields.includes("schedule") ? {
          schedule: cloneData(remote.schedule || []),
          seasonInfo: cloneData(remote.seasonInfo || {}),
          backedUpAt: new Date().toISOString(),
          completedMatches: (remote.schedule || []).filter(match => match.hs !== null && match.as !== null).length
        } : remote.scheduleBackup;
      transaction.set(leagueRef, { ...patch, ...(cloudScheduleBackup ? { scheduleBackup: cloudScheduleBackup } : {}), updatedAt, serverUpdatedAt: serverTimestamp() }, { merge: true });
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeNewsNotifications, { once: true });
} else {
  initializeNewsNotifications();
}
