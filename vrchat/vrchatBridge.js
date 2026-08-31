import { exec } from "child_process";
import { readFile, writeFile } from "fs/promises";
import WebSocket from "ws";
import cfg from "../util/config.js";

const realLog = (msg) => process.stdout.write(msg + "\n");

const API_BASE = "https://api.vrchat.cloud/api/1";
// VRChat's API policy wants a descriptive User-Agent with contact info --
// generic ones get rate-limited harder. Override via config if you want.
const USER_AGENT = cfg.VRCHAT_USER_AGENT || "LilyVRBridge/1.0 contact@example.com";
const SESSION_PATH = cfg.VRCHAT_SESSION_PATH || "./.vrchat_session.json";

// Cookie jar. VRChat auth is old-school cookie-based (an "auth" cookie,
// briefly a "twoFactorAuth" cookie mid-login) -- there's no OAuth flow.
const cookies = new Map();

let ws = null;
let reconnectTimer = null;
let autoJoinEnabled = cfg.VRCHAT_AUTOJOIN_ON_START ?? true;

function storeCookiesFrom(res) {
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

function cookieHeaderString() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function loadSession() {
  try {
    const raw = await readFile(SESSION_PATH, "utf-8");
    for (const [k, v] of Object.entries(JSON.parse(raw))) cookies.set(k, v);
  } catch {
    // no saved session yet -- fine, ensureLoggedIn() will do a fresh login
  }
}

async function saveSession() {
  try {
    await writeFile(SESSION_PATH, JSON.stringify(Object.fromEntries(cookies)), "utf-8");
  } catch (err) {
    realLog(`[vrchat] couldn't persist session: ${err.message}`);
  }
}

// Reuses a saved cookie if it's still valid, so this doesn't hit VRChat's
// login rate limit on every restart.
async function verifySession() {
  if (!cookies.has("auth")) return false;
  const res = await fetch(`${API_BASE}/auth/user`, {
    headers: { "User-Agent": USER_AGENT, Cookie: cookieHeaderString() },
  });
  storeCookiesFrom(res);
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data?.id);
}

async function rawLogin() {
  const basic = Buffer.from(
    `${encodeURIComponent(cfg.VRCHAT_USERNAME)}:${encodeURIComponent(cfg.VRCHAT_PASSWORD)}`
  ).toString("base64");
  const res = await fetch(`${API_BASE}/auth/user`, {
    headers: { "User-Agent": USER_AGENT, Authorization: `Basic ${basic}` },
  });
  storeCookiesFrom(res);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`login failed: ${res.status} ${res.statusText} -- ${body}`);
  }
  return res.json();
}

// method is one of VRChat's requiresTwoFactorAuth values: "totp", "otp"
// (recovery codes), or "emailOtp".
async function getTwoFactorCode(method) {
  if (method === "totp" && cfg.VRCHAT_TOTP_SECRET) {
    const { authenticator } = await import("otplib");
    const secret = cfg.VRCHAT_TOTP_SECRET.replace(/\s+/g, "").toUpperCase();
    return authenticator.generate(secret);
  }
  throw new Error(
    `2FA required (${method}) but no VRCHAT_TOTP_SECRET is set in config.json -- ` +
    `either set that (your authenticator app's setup secret, not a single code), ` +
    `or log in once yourself and copy the resulting "auth" cookie value into ${SESSION_PATH} ` +
    `as {"auth": "..."}`
  );
}

async function verifyTwoFactor(method, code) {
  const endpoint = method === "emailOtp" ? "emailotp" : method;
  const res = await fetch(`${API_BASE}/auth/twofactorauth/${endpoint}/verify`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Cookie: cookieHeaderString() },
    body: JSON.stringify({ code }),
  });
  storeCookiesFrom(res);
  if (!res.ok) throw new Error(`2FA verification failed: ${res.status} ${res.statusText}`);
}

async function ensureLoggedIn() {
  await loadSession();
  if (await verifySession()) {
    realLog("[vrchat] reusing saved session");
    return;
  }

  realLog("[vrchat] logging in...");
  const data = await rawLogin();
  if (data.requiresTwoFactorAuth?.length) {
    const method = data.requiresTwoFactorAuth.includes("totp") ? "totp" : data.requiresTwoFactorAuth[0];
    await verifyTwoFactor(method, await getTwoFactorCode(method));
  }
  await saveSession();
  realLog("[vrchat] logged in");
}

// Best-effort parse -- VRChat doesn't publish a formal schema for
// NotificationDetailInvite. Community bots/tools read the join location
// out of details.worldId, which for a real invite holds the FULL
// "wrld_xxx:instanceId~params..." string, not just the world's GUID. The
// debug log in handleInviteNotification() prints the raw shape the first
// few times so you can confirm/adjust this if VRChat's changed it.
function extractLocation(details) {
  const worldId = details?.worldId;
  if (typeof worldId === "string" && worldId.includes(":")) return worldId;
  return null;
}

function launchCommand(url) {
  const platform = String(cfg.PLATFORM || "GNOME").toUpperCase();
  if (platform === "WINDOWS") return `start "" "${url}"`;
  // KDE and GNOME: xdg-open hands off to whatever registered the vrchat://
  // scheme (VRChat's own installer on Windows does this automatically;
  // on Linux/Proton it depends on your setup -- test this once).
  return `xdg-open "${url}"`;
}

async function handleInviteNotification(content) {
  if (cfg.VRCHAT_TRUSTED_INVITER_ID && content.senderUserId !== cfg.VRCHAT_TRUSTED_INVITER_ID) {
    realLog(`[vrchat] ignoring invite from ${content.senderUserId} (not the trusted inviter)`);
    return;
  }
  if (!autoJoinEnabled) {
    realLog("[vrchat] invite received but auto-join is toggled off");
    return;
  }

  let details = content.details;
  if (typeof details === "string") {
    try { details = JSON.parse(details); } catch { details = {}; }
  }
  realLog(`[vrchat] invite details: ${JSON.stringify(details)}`);

  const location = extractLocation(details);
  if (!location) {
    realLog("[vrchat] couldn't find a joinable location in this invite, skipping auto-join");
    return;
  }

  const url = `vrchat://launch?id=${encodeURIComponent(location)}`;
  realLog(`[vrchat] auto-joining: ${location}`);
  exec(launchCommand(url), (err) => {
    if (err) realLog(`[vrchat] failed to launch: ${err.message}`);
  });
}

function connectPipeline() {
  const authToken = cookies.get("auth");
  if (!authToken) {
    realLog("[vrchat] no auth token, can't open pipeline websocket");
    return;
  }

  ws = new WebSocket(`wss://pipeline.vrchat.cloud/?authToken=${authToken}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  ws.on("open", () => realLog("[vrchat] pipeline connected"));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "notification") return;

    let content = msg.content;
    if (typeof content === "string") {
      try { content = JSON.parse(content); } catch { return; }
    }
    if (content?.type === "invite") {
      handleInviteNotification(content).catch((err) => realLog(`[vrchat] invite handling failed: ${err.message}`));
    }
  });

  ws.on("close", () => {
    realLog("[vrchat] pipeline closed, reconnecting in 5s...");
    reconnectTimer = setTimeout(connectPipeline, 5000);
  });

  ws.on("error", (err) => realLog(`[vrchat] pipeline error: ${err.message}`));
}

export async function initVrchatAutoJoin() {
  if (!cfg.VRCHAT_USERNAME || !cfg.VRCHAT_PASSWORD) {
    realLog("[vrchat] VRCHAT_USERNAME/VRCHAT_PASSWORD not set in config.json, auto-join disabled");
    return;
  }
  try {
    await ensureLoggedIn();
    connectPipeline();
  } catch (err) {
    realLog(`[vrchat] setup failed: ${err.message}`);
  }
}

export function stopVrchatAutoJoin() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
}

// Toggled by pressing 'j' in the terminal.
export function toggleAutoJoin() {
  autoJoinEnabled = !autoJoinEnabled;
  realLog(`[vrchat] auto-join ${autoJoinEnabled ? "enabled" : "disabled"}`);
  return autoJoinEnabled;
}

export function isAutoJoinEnabled() {
  return autoJoinEnabled;
}