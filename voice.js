import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);
const EDGE_TTS_BIN = "/home/izansolaserver/.local/bin/edge-tts"; // adjust if it's not on PATH, e.g. full path from `which edge-tts`
const SINK_NAME = "lily_voice";

function sanitizeInput(text) {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export async function speak(text) {
  const clean = sanitizeInput(text);
  if (!clean) return;
  const escaped = clean.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const wavPath = "/tmp/lily_response.wav";

  try {
    await execAsync(`${EDGE_TTS_BIN} --text "${escaped}" --voice en-US-AnaNeural --write-media ${wavPath}`);
    // Play directly into the virtual sink instead of converting to ogg --
    // no Discord upload step here, this just needs to reach VRChat's "mic"
    await execAsync(`paplay --device=${SINK_NAME} ${wavPath}`);
  } catch (err) {
    console.error("[voice] speak failed:", err.message);
  } finally {
    fs.unlink(wavPath, () => {});
  }
}