import { spawn } from "child_process";
import { unlink } from "fs/promises";
import { nodewhisper } from "nodejs-whisper";
import cfg from "./config.js";
import { queryBrainText, queryBrainButtIn } from "./brain.js";
import { handleReply, checkCooldown } from "./server.js";
import { setStatus } from "./status.js";

const realLog = (msg) => process.stdout.write(msg + "\n");

let running = false;
let chunkCounter = 0;
let ambientBuffer = [];
let buttInTimer = null;

function captureChunk(outPath, seconds, id) {
  return new Promise((resolve, reject) => {
    let remaining = seconds;
    realLog(`[voice] #${id} recording... ${remaining}`);
    setStatus(`Listening: ${remaining}s...`);

    const countdown = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        realLog(`[voice] #${id} recording... ${remaining}`);
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

    proc.on("exit", () => { clearInterval(countdown); resolve(); });
    proc.on("error", (err) => { clearInterval(countdown); reject(err); });
  });
}

async function transcribe(wavPath) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  try {
    const result = await nodewhisper(wavPath, {
      modelName: cfg.WHISPER_MODEL,
      autoDownloadModelName: cfg.WHISPER_MODEL,
      removeWavFileAfterTranscription: false,
      withCuda: false,
      whisperOptions: { outputInText: true, language: "en" },
    });
    return (result ?? "").replace(/\n/g, " ").trim();
  } catch {
    return "";
  } finally {
    process.stdout.write = originalWrite;
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
    const id = chunkCounter++;
    const path = `/tmp/lily_incoming_audio_${id}.wav`;

    await captureChunk(path, cfg.AUDIO_CHUNK_SECONDS, id);

    realLog(`[voice] #${id} processing audio...`);
    setStatus("Processing audio...");
    const rawText = await transcribe(path);
    realLog(`[voice] #${id} processed audio.`);
    await unlink(path).catch(() => {});

    const text = cleanTranscript(rawText);
    realLog(`[voice] #${id} heard: "${text}"`);

    if (text) {
      ambientBuffer.push(text);

      const trigger = extractWakeSentence(text);
      if (trigger) {
        const remaining = checkCooldown();
        if (remaining <= 0) {
          realLog(`[voice] input: ${trigger}`);
          setStatus("Thinking...");
          const reply = await queryBrainText(trigger);
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
  const transcript = ambientBuffer.join(" ").trim();
  ambientBuffer = [];

  if (transcript && checkCooldown() <= 0) {
    setStatus("Thinking...");
    const reply = await queryBrainButtIn(transcript);
    if (reply !== "NONE") {
      realLog(`[voice] butt-in: ${reply}`);
      await handleReply(reply);
    }
  }

  scheduleNextButtIn();
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
}