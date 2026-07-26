import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";

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
const notificationConfig = window.FNL_NOTIFICATION_CONFIG || {};
const notificationEnabledKey = "fnl-news-notifications-enabled";
const notificationTokenKey = "fnl-news-notification-token";
let applyingRemote = false;
let unsubscribe;
let messaging;
let foregroundListenerBound = false;

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
    if (remote.regulations && typeof remote.regulations === "object") state.regulations = remote.regulations;
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
    regulations: state.regulations,
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeNewsNotifications, { once: true });
} else {
  initializeNewsNotifications();
}
