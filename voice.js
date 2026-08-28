import { spawn } from "child_process";
import cfg from "./config.js";

const SINK_NAME = "lily_voice";
const SAMPLE_RATE = 24000; // must match xtts_server.py's SAMPLE_RATE

function sanitizeInput(text) {
  return text.replace(/[\r\n]+/g, " ").trim();
  // No shell-escaping needed here anymore -- this used to strip apostrophes
  // (via brain.js's fixEscapedApostrophes) to survive being passed as a CLI
  // arg to edge-tts. Now the text goes over HTTP as a JSON body instead, so
  // that concern doesn't apply to the voice pipeline anymore -- fixEscapedApostrophes
  // is still applied upstream in brain.js though, since that also touches the
  // chatbox text, which is a separate decision.
}

// Streams from the local XTTS sidecar (see xtts_server.py) and plays the
// audio as it arrives -- this is what gets Lily talking before the whole
// reply has finished generating, instead of waiting on one big file.
export async function speak(text) {
  const clean = sanitizeInput(text);
  if (!clean) return;

  let res;
  try {
    res = await fetch(cfg.VOICE_SIDECAR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
  } catch (err) {
    console.error("[voice] couldn't reach xtts_server:", err.message);
    return;
  }

  if (!res.ok || !res.body) {
    console.error(`[voice] speak failed: xtts_server returned ${res.status}`);
    return;
  }

  const player = spawn("paplay", [
    "--raw",
    `--rate=${SAMPLE_RATE}`,
    "--format=s16le",
    "--channels=1",
    `--device=${SINK_NAME}`,
  ]);
  player.on("error", (err) => console.error("[voice] paplay failed to start:", err.message));

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      player.stdin.write(Buffer.from(value));
    }
  } catch (err) {
    console.error("[voice] stream read failed:", err.message);
  } finally {
    player.stdin.end();
  }

  await new Promise((resolve) => player.on("exit", resolve));
}