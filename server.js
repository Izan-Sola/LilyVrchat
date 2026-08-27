import express from "express";
import { say } from "./chatbox.js";
import { queryBrainMessage } from "./brain.js";
import { speak } from "./voice.js";


//const IDLE_MESSAGE = "[ShinyShadow_'s AI Daughter] Talk to me via the web interface linked in my profile. (WIP: prompt her via voice)";
const IDLE_MESSAGE = ""

const IDLE_RESEND_INTERVAL_MS = 15000;
const REPLY_HOLD_MS = 8500;
const COOLDOWN_MS = 10000;
export function handleReply(reply) {
  stopIdleLoop();
  if (replyTimer) clearTimeout(replyTimer);
  say(reply);
  const speakPromise = speak(reply); // capture the promise instead of firing-and-forgetting
  replyTimer = setTimeout(startIdleLoop, REPLY_HOLD_MS);
  return speakPromise;
}
export { checkCooldown };
let idleInterval = null;
let replyTimer = null;
let lastSentAt = 0;

export function showIdleMessage() {
  say(IDLE_MESSAGE);
}

function startIdleLoop() {
  stopIdleLoop();
  showIdleMessage();
  idleInterval = setInterval(showIdleMessage, IDLE_RESEND_INTERVAL_MS);
}

function stopIdleLoop() {
  if (idleInterval) clearInterval(idleInterval);
  idleInterval = null;
}

function showReplyThenRevert(reply) {
  stopIdleLoop();
  if (replyTimer) clearTimeout(replyTimer);
  say(reply);
  replyTimer = setTimeout(startIdleLoop, REPLY_HOLD_MS);
}

function checkCooldown() {
  const now = Date.now();
  const elapsed = now - lastSentAt;
  if (elapsed < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - elapsed) / 1000);
  }
  lastSentAt = now;
  return 0;
}

const PAGE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Lily VRChat Console</title>
  <style>
    body { font-family: sans-serif; background: #1a1a1e; color: #eee; padding: 2rem; max-width: 600px; margin: auto; }
    textarea { width: 100%; height: 80px; font-size: 1rem; padding: 0.5rem; box-sizing: border-box; }
    button { font-size: 1rem; padding: 0.6rem 1.2rem; margin-top: 0.5rem; margin-right: 0.5rem; cursor: pointer; }
    #log { margin-top: 1.5rem; white-space: pre-wrap; background: #111; padding: 1rem; border-radius: 6px; min-height: 4rem; }
    .sent { color: #8ab4f8; }
    .reply { color: #7ee787; }
  </style>
</head>
<body>
  <h2>Lily VRChat Console</h2>
  <textarea id="msg" placeholder="Type a message..."></textarea><br/>
  <button id="sendText">Send</button>
  <button id="sendVision">Send + Screenshot of what SHE sees. </button>
  <div id="log"></div>
 <h1> Info: <br> <br> </h1>
  <p> Via this web interface you can input prompts to her and she will reply in game. There is a 10 second global cooldown. <br> <br>
      The screenshot option might take a bit longer to process. If you wanna know more about Lily, check the whole project: https://github.com/Izan-Sola/Lily
 </p> <script>
    const msgEl = document.getElementById("msg");
    const logEl = document.getElementById("log");

    function logLine(cls, text) {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    async function send(withVision) {
      const text = msgEl.value.trim();
      if (!text) return;
      logLine("sent", "You" + (withVision ? " (+screenshot)" : "") + ": " + text);
      msgEl.value = "";
      try {
        const res = await fetch(withVision ? "/api/vision" : "/api/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (res.status === 429) {
          logLine("reply", "(" + data.error + ")");
          return;
        }
        logLine("reply", "Lily: " + (data.reply ?? "(error)"));
      } catch (err) {
        logLine("reply", "Lily: (request failed)");
      }
    }

    document.getElementById("sendText").onclick = () => send(false);
    document.getElementById("sendVision").onclick = () => send(true);
    msgEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); }
    });
  </script>
</body>
</html>
`;

export function startWebServer(port = 3000) {
  const app = express();
  app.use(express.json());
  startIdleLoop();

  app.get("/", (req, res) => res.send(PAGE));

  app.post("/api/text", async (req, res) => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      return res.status(429).json({ error: `Cooldown active, wait ${remaining}s` });
    }
    const text = (req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty message" });
    console.log(`[chat] IN  (text): ${text}`);
    try {
      const reply = await queryBrainMessage("user", text);
      console.log(`[chat] OUT (text): ${reply}`);
      showReplyThenRevert(reply);
      speak(reply);
      res.json({ reply });
    } catch (err) {
      console.error(`[chat] text failed: ${err.message}`);
      res.status(500).json({ error: "message processing failed" });
    }
  });

  app.post("/api/vision", async (req, res) => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      return res.status(429).json({ error: `Cooldown active, wait ${remaining}s` });
    }
    const text = (req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty message" });
    console.log(`[chat] IN  (vision): ${text}`);
    try {
      const reply = await queryBrainMessage("user", text, { withImage: true });
      console.log(`[chat] OUT (vision): ${reply}`);
      showReplyThenRevert(reply);
      speak(reply);
      res.json({ reply });
    } catch (err) {
      console.error(`[chat] vision failed: ${err.message}`);
      res.status(500).json({ error: "screenshot capture failed" });
    }
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`[web] Lily console at http://<laptop-ip>:${port}`);
  });
}