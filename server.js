import express from "express";
import { say } from "./chatbox.js";
import { queryBrainText, queryBrainVision } from "./brain.js";
import { captureBase64 } from "./perception.js";
import { speak } from "./voice.js";
const IDLE_MESSAGE = "[ShinyShadow_'s AI Daughter] To talk to me, click the link in my profile and input your prompt through the web interface.";
const IDLE_DELAY_MS = 5000; // how long her real reply stays up before reverting to idle text

let idleTimer = null;

export function showIdleMessage() {
  say(IDLE_MESSAGE);
}

function showReplyThenRevert(reply) {
  if (idleTimer) clearTimeout(idleTimer);
  say(reply);
  idleTimer = setTimeout(showIdleMessage, IDLE_DELAY_MS);
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

  <script>
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

  app.get("/", (req, res) => res.send(PAGE));

app.post("/api/text", async (req, res) => {
  const text = (req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "empty message" });
  const reply = await queryBrainText(text);
  showReplyThenRevert(reply);
  speak(reply);
  res.json({ reply });
});

app.post("/api/vision", async (req, res) => {
  const text = (req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "empty message" });
  try {
    const imageBase64 = await captureBase64();
    const reply = await queryBrainVision(text, imageBase64);
    showReplyThenRevert(reply);
    speak(reply);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "screenshot capture failed" });
  }
});
  app.listen(port, "0.0.0.0", () => {
    console.log(`[web] Lily console at http://<laptop-ip>:${port}`);
  });
}