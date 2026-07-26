const ALLOWED_ORIGIN = "https://soccerykohi-eng.github.io";
const APP_URL = "https://soccerykohi-eng.github.io/FOOTBALL-NINE-LEAGUE/";
const FIRESTORE_DOCUMENT = "shared/fnl-season1";
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const corsHeaders = origin => ({
  "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
});

const json = (data, status = 200, origin = ALLOWED_ORIGIN) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) }
});

const base64Url = bytes => {
  const source = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  source.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const pemToArrayBuffer = pem => {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
};

const getServiceAccount = env => {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is invalid");
  }
  return account;
};

const getAccessToken = async env => {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) return cachedAccessToken;
  const account = getServiceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  const assertion = `${unsignedToken}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.error_description || "Google authentication failed");
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, (result.expires_in || 3600) - 120) * 1000;
  return cachedAccessToken;
};

const decodeFirestoreValue = value => {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }
  return null;
};

const getLatestNews = async env => {
  const account = getServiceAccount(env);
  const token = await getAccessToken(env);
  const path = FIRESTORE_DOCUMENT.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error(`Firestore lookup failed (${response.status})`);
  const document = await response.json();
  const news = decodeFirestoreValue(document.fields?.news) || [];
  return Array.isArray(news) ? news[0] : null;
};

const tokenKey = async token => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `subscriber:${base64Url(digest)}`;
};

const listSubscribers = async env => {
  const subscribers = [];
  let cursor;
  do {
    const page = await env.PUSH_STORE.list({ prefix: "subscriber:", cursor });
    const values = await Promise.all(page.keys.map(item => env.PUSH_STORE.get(item.name, "json")));
    values.filter(Boolean).forEach(value => subscribers.push(value));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return subscribers;
};

const sendToToken = async (env, token, news) => {
  const account = getServiceAccount(env);
  const accessToken = await getAccessToken(env);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: "FNL NEWS",
          body: news.title || "新しいニュースが公開されました。"
        },
        data: {
          newsId: String(news.id || ""),
          url: APP_URL
        },
        webpush: {
          fcm_options: { link: APP_URL },
          notification: {
            icon: `${APP_URL}fnl-logo.png`,
            badge: `${APP_URL}fnl-logo.png`
          }
        }
      }
    })
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
};

const notifyLatestNews = async (env, requestedNewsId) => {
  const latestNews = await getLatestNews(env);
  if (!latestNews?.id || latestNews.id !== requestedNewsId) {
    throw new Error("The requested news is not the latest published item");
  }
  const sentKey = `sent:${requestedNewsId}`;
  if (await env.PUSH_STORE.get(sentKey)) return { alreadySent: true, delivered: 0 };

  const subscribers = await listSubscribers(env);
  let delivered = 0;
  await Promise.all(subscribers.map(async subscriber => {
    const result = await sendToToken(env, subscriber.token, latestNews);
    if (result.ok) {
      delivered += 1;
      return;
    }
    if (result.status === 404 || result.text.includes("UNREGISTERED")) {
      await env.PUSH_STORE.delete(await tokenKey(subscriber.token));
    }
  }));
  await env.PUSH_STORE.put(sentKey, JSON.stringify({
    newsId: requestedNewsId,
    delivered,
    sentAt: new Date().toISOString()
  }));
  return { alreadySent: false, delivered };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({ ok: true, service: "fnl-news-notifications" }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Not found" }, 404, origin);
    if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403, origin);
    if (!env.PUSH_STORE) return json({ error: "PUSH_STORE is not configured" }, 500, origin);

    try {
      const body = await request.json();
      if (url.pathname === "/subscribe") {
        if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 4096) {
          return json({ error: "Invalid notification token" }, 400, origin);
        }
        await env.PUSH_STORE.put(await tokenKey(body.token), JSON.stringify({
          token: body.token,
          subscribedAt: new Date().toISOString()
        }));
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/unsubscribe") {
        if (typeof body.token === "string" && body.token) {
          await env.PUSH_STORE.delete(await tokenKey(body.token));
        }
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/notify-news") {
        if (typeof body.newsId !== "string" || !body.newsId) {
          return json({ error: "newsId is required" }, 400, origin);
        }
        return json({ ok: true, ...(await notifyLatestNews(env, body.newsId)) }, 200, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: error.message || "Notification request failed" }, 500, origin);
    }
  }
};
