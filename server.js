import express from "express";
import { setStatus } from "./status.js";
import { queryBrainText, queryBrainVision } from "./brain.js";
import { captureBase64 } from "./perception.js";
import { speak } from "./voice.js";

const COOLDOWN_MS = 10000;

// Pushes the reply to the chatbox (with title prefix, via setStatus) and
// speaks it aloud. No idle message to manage anymore -- whatever's on the
// chatbox just sits there until the next status update (next listening
// cycle, next reply, etc.) overwrites it.
export function handleReply(reply) {
  setStatus(reply);
  const speakPromise = speak(reply); // capture the promise instead of firing-and-forgetting
  return speakPromise;
}
export { checkCooldown };
let lastSentAt = 0;

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
 <h1>READ THIS: <br> <br> </h1>
  <p> Via this web interface you can input prompts to her and she will reply in game. There is a 10 second global cooldown <br> <br>
  You can also speak to her in game by saying her name (Lily) in your sentence, but it can be inconsistent (not the best hardware on my side plus <br><br>
  the noise/voices around can mess with the audio capture) </p> <script>
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

  app.get("/", (req, res) => res.send(PAGE));

  app.post("/api/text", async (req, res) => {
    const remaining = checkCooldown();
    if (remaining > 0) {
      return res.status(429).json({ error: `Cooldown active, wait ${remaining}s` });
    }
    const text = (req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty message" });
    console.log(`[chat] IN  (text): ${text}`);
    setStatus("Thinking...");
    const reply = await queryBrainText(text);
    console.log(`[chat] OUT (text): ${reply}`);
    handleReply(reply);
    res.json({ reply });
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
      setStatus("Looking + Thinking...");
      const imageBase64 = await captureBase64();
      const reply = await queryBrainVision(text, imageBase64);
      console.log(`[chat] OUT (vision): ${reply}`);
      handleReply(reply);
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