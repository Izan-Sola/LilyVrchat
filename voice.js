import { spawn } from "child_process";
import cfg from "./config.js";

const SINK_NAME = "lily_voice";
const SAMPLE_RATE = 24000; // edge-tts's default output rate for most neural voices

// Which edge-tts voice to speak with -- set EDGE_TTS_VOICE in config.json
// to override. Run `edge-tts --list-voices` to see all options; anything
// like "en-US-AvaNeural", "en-US-AnaNeural" (younger-sounding), or a
// non-English voice all work the same way.
const DEFAULT_VOICE = "en-US-AnaNeural";

// The pipeline lock in server.js (requestReply/pipelineBusy) should
// already guarantee speak() is never called while a previous call is
// still playing. These track the in-flight processes anyway as a second
// line of defense -- if that guarantee is ever violated, we tear down the
// old pipeline instead of letting two audio streams overlap.
let activePlayer = null;
let activeUpstream = []; // [synth, decoder] -- killed alongside activePlayer

function sanitizeInput(text) {
  return text.replace(/[\r\n]+/g, " ").trim();
  // No shell-escaping needed -- spawn() below passes args straight to
  // execve (no shell:true), so apostrophes/quotes in the text are safe
  // as-is; this is just cleaning up line breaks so edge-tts gets one
  // continuous utterance.
}

function killActive() {
  activeUpstream.forEach((p) => p.kill("SIGTERM"));
  if (activePlayer) activePlayer.kill("SIGTERM");
  activeUpstream = [];
  activePlayer = null;
}

// Three chained processes, piped stdout->stdin, so playback can start
// before the whole utterance has finished synthesizing (same "start
// talking before the full reply is ready" goal the old XTTS streaming
// path had):
//   edge-tts --write-media -   (streams mp3 bytes to stdout as it synths)
//     -> ffmpeg (decodes mp3 -> raw s16le PCM on the fly)
//       -> paplay (plays the raw PCM on the lily_voice sink)
export async function speak(text) {
  const clean = sanitizeInput(text);
  if (!clean) return;

  if (activePlayer) {
    console.warn("[voice] speak() called while already playing -- stopping previous playback");
    killActive();
  }

    const voice =  DEFAULT_VOICE;
    const rate = "+20%"
    const synth = spawn("edge-tts", ["--voice", voice, "--rate", rate, "--text", clean, "--write-media", "-"]);
    synth.on("error", (err) => console.error("[voice] edge-tts failed to start:", err.message));
    synth.stderr.on("data", () => {}); // edge-tts logs progress to stderr -- noise, ignore

  const decoder = spawn("ffmpeg", [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-f", "s16le",
    "-ar", String(SAMPLE_RATE),
    "-ac", "1",
    "pipe:1",
  ]);
  decoder.on("error", (err) => console.error("[voice] ffmpeg failed to start:", err.message));

  const player = spawn("paplay", [
    "--raw",
    `--rate=${SAMPLE_RATE}`,
    "--format=s16le",
    "--channels=1",
    `--device=${SINK_NAME}`,
  ]);
  player.on("error", (err) => console.error("[voice] paplay failed to start:", err.message));

  synth.stdout.pipe(decoder.stdin);
  decoder.stdout.pipe(player.stdin);

  activeUpstream = [synth, decoder];
  activePlayer = player;

  await new Promise((resolve) => player.on("exit", resolve));

  if (activePlayer === player) activePlayer = null;
  if (activeUpstream[0] === synth) activeUpstream = [];
}