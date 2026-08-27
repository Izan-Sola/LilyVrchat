import { spawn } from "child_process";
import { unlink, readFile } from "fs/promises";
import cfg from "./config.js";
import { queryBrainMessage } from "./brain.js";
import { handleReply, checkCooldown } from "./server.js";
import { setStatus } from "./status.js";

const realLog = (msg) => process.stdout.write(msg + "\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let running = false;
let chunkCounter = 0;
let ambientBuffer = [];
let lastTranscript = ""; // most recent non-empty ambient transcription -- backspace/tab force-send this
let buttInTimer = null;
let buttInEnabled = true;

// -- timed (wake-word) chunk recording ---------------------------------
let currentProc = null;
let currentMode = null; // "timed" while a normal wake-word chunk is recording
let discardNextResult = false;

// -- manual (untimed) push-to-talk recording ---------------------------
const MANUAL_AUDIO_PATH = "/tmp/lily_manual_audio.wav";
let manualProc = null;
let manualActive = false;

function captureChunk(outPath, seconds, id) {
  return new Promise((resolve, reject) => {
    let remaining = seconds;
    realLog(`[voice] > Recording... ${remaining}`);
    setStatus(`Listening: ${remaining}s...`);

    const countdown = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        realLog(`[voice] > Recording... ${remaining}`);
        setStatus(`Listening: ${remaining}s...`);
      }
    }, 1000);

    const proc = spawn("timeout", [
      `${seconds}s`,
      "parec",
      "--file-format=wav",
      "--channels=1",
      "--rate=16000",
      "-d", cfg.AUDIO_MONITOR_SOURCE,
      outPath,
    ]);

    currentProc = proc;
    currentMode = "timed";

    proc.on("exit", () => {
      clearInterval(countdown);
      currentProc = null;
      currentMode = null;
      resolve();
    });
    proc.on("error", (err) => {
      clearInterval(countdown);
      currentProc = null;
      currentMode = null;
      reject(err);
    });
  });
}

// Cuts the current timed listening chunk short (spacebar pressed) so it
// moves straight to processing instead of waiting out the countdown.
// `timeout` (the wrapper process we spawned) forwards the signal down to
// `parec`, same as it does when the countdown naturally expires.
export function skipCurrentRecording() {
  if (currentProc && currentMode === "timed") {
    realLog("[voice] skip requested -- cutting listening short");
    currentProc.kill("SIGTERM");
  }
}

// Triggered by pressing Backspace (no image) or Tab (with image) in the
// terminal. Force-sends whatever the last ambient chunk transcribed, no
// wake word or cooldown required -- sends unconditionally, same as the
// manual (Enter) path does. `withImage` opts into a screenshot for this
// one forced send only; the regular voice paths stay text-only since
// attaching a screenshot every turn was too slow for live back-and-forth.
export async function forceSendLastTranscript(withImage = false) {
  const text = lastTranscript;
  if (!text) {
    realLog(`[voice] force-send pressed but nothing transcribed yet`);
    return;
  }
  lastTranscript = "";

  realLog(`[voice] input (forced${withImage ? " +image" : ""}): ${text}`);
  setStatus(withImage ? "Thinking (with image)..." : "Thinking...");
  const reply = await queryBrainMessage("user", text, { withImage });
  realLog(`[voice] lily response (forced): ${reply}`);
  await handleReply(reply);
}

// Same idea, but used when switching into manual recording: the
// interrupted chunk gets thrown away instead of transcribed/processed.
function interruptForManualMode() {
  if (currentProc && currentMode === "timed") {
    discardNextResult = true;
    currentProc.kill("SIGTERM");
  }
}

async function transcribe(wavPath) {
  try {
    const buf = await readFile(wavPath);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");

    const res = await fetch(cfg.WHISPER_SERVER_URL, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      realLog(`[voice] whisper server returned ${res.status}`);
      return "";
    }

    const data = await res.json();
    if (data.error) {
      realLog(`[voice] whisper server error: ${data.error}`);
      return "";
    }
    return (data.text ?? "").replace(/\n/g, " ").trim();
  } catch (err) {
    realLog(`[voice] transcription request failed: ${err.message}`);
    return "";
  }
}

function cleanTranscript(text) {
  return text.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").trim();
}

function extractWakeSentence(text) {
  const wakeWords = (Array.isArray(cfg.VOICE_WAKE_WORD) ? cfg.VOICE_WAKE_WORD : [cfg.VOICE_WAKE_WORD])
    .map(w => w.toLowerCase());
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const sLower = s.toLowerCase();
    if (wakeWords.some(w => sLower.includes(w))) return s.trim();
  }
  return null;
}

async function loop() {
  while (running) {
    if (manualActive) {
      // yield the mic while a manual (untimed) recording is in progress
      await sleep(200);
      continue;
    }

    const id = chunkCounter++;
    const path = `/tmp/lily_incoming_audio_${id}.wav`;

    await captureChunk(path, cfg.AUDIO_CHUNK_SECONDS, id);

    if (discardNextResult) {
      discardNextResult = false;
      await unlink(path).catch(() => {});
      continue;
    }

    realLog(`[voice] > Processing audio...`);
    setStatus("Processing audio...");
    const rawText = await transcribe(path);
    realLog(`[voice] > Processed audio.`);
    await unlink(path).catch(() => {});

    const text = cleanTranscript(rawText);
    realLog(`[voice] > Heard: "${text}"`);

    if (text) {
      ambientBuffer.push(text);
      lastTranscript = text;

      const trigger = extractWakeSentence(text);
      if (trigger) {
        const remaining = checkCooldown();
        if (remaining <= 0) {
          realLog(`[voice] input: ${trigger}`);
          setStatus("Thinking...");
          const reply = await queryBrainMessage("user", trigger);
          realLog(`[voice] lily response: ${reply}`);
          await handleReply(reply); // wait for her to actually finish speaking before looping
        }
      }
    }
  }
}

function scheduleNextButtIn() {
  const delay = cfg.BUTTIN_MIN_MS + Math.random() * (cfg.BUTTIN_MAX_MS - cfg.BUTTIN_MIN_MS);
  buttInTimer = setTimeout(runButtInCheck, delay);
}

async function runButtInCheck() {
  if (manualActive) {
    scheduleNextButtIn();
    return;
  }

  const transcript = ambientBuffer.join(" ").trim();
  ambientBuffer = [];

  if (buttInEnabled && transcript && checkCooldown() <= 0) {
    setStatus("Thinking...");
    const reply = await queryBrainMessage("ambient", transcript);
    if (reply !== "NONE") {
      realLog(`[voice] butt-in: ${reply}`);
      await handleReply(reply);
    }
  }

  scheduleNextButtIn();
}

// Toggled by pressing "b" in the terminal.
export function toggleButtIn() {
  buttInEnabled = !buttInEnabled;
  realLog(`[voice] butt-in ${buttInEnabled ? "enabled" : "disabled"}`);
  return buttInEnabled;
}

export function isButtInEnabled() {
  return buttInEnabled;
}

// Toggled by pressing Enter on an empty line. Records with no timer at
// all -- everything said between the two Enter presses gets transcribed
// and sent straight to the brain, bypassing the wake word entirely.
export async function toggleManualRecording() {
  if (manualActive) {
    await stopManualRecording();
  } else {
    startManualRecording();
  }
}

export function isManualRecording() {
  return manualActive;
}

function startManualRecording() {
  if (manualActive) return;
  manualActive = true;

  // hand over the mic if a timed ambient chunk is mid-recording
  interruptForManualMode();

  realLog("[voice] manual recording started (press Enter to stop)...");
  setStatus("Listening...");

  manualProc = spawn("parec", [
    "--file-format=wav",
    "--channels=1",
    "--rate=16000",
    "-d", cfg.AUDIO_MONITOR_SOURCE,
    MANUAL_AUDIO_PATH,
  ]);
  manualProc.on("error", (err) => {
    realLog(`[voice] manual recording failed to start: ${err.message}`);
    manualActive = false;
    manualProc = null;
  });
}

async function stopManualRecording() {
  if (!manualActive || !manualProc) return;
  const proc = manualProc;
  manualProc = null;
  // manualActive stays true through transcription + reply, same as the
  // timed path staying inside its own await chain -- otherwise the ambient
  // loop jumps in and starts a new chunk mid-processing.

  realLog("[voice] manual recording stopped, processing...");
  setStatus("Processing audio...");

  await new Promise((resolve) => {
    proc.once("exit", resolve);
    proc.kill("SIGTERM");
  });

  const rawText = await transcribe(MANUAL_AUDIO_PATH);
  await unlink(MANUAL_AUDIO_PATH).catch(() => {});
  const text = cleanTranscript(rawText);
  realLog(`[voice] manual heard: "${text}"`);

  if (!text) {
    realLog("[voice] manual recording was empty, nothing to send");
    manualActive = false;
    return;
  }

  realLog(`[voice] input (manual): ${text}`);
  setStatus("Thinking...");
  const reply = await queryBrainMessage("user", text);
  realLog(`[voice] lily response (manual): ${reply}`);
  await handleReply(reply);
  manualActive = false;
}

export function startVoiceListener() {
  running = true;
  realLog(`[voice] listening for "${cfg.VOICE_WAKE_WORD}"...`);
  loop();
  scheduleNextButtIn();
}

export function stopVoiceListener() {
  running = false;
  if (buttInTimer) clearTimeout(buttInTimer);
  if (currentProc) currentProc.kill("SIGTERM");
  if (manualProc) manualProc.kill("SIGTERM");
}