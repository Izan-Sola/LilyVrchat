import readline from "readline";
import { initOsc } from "./osc.js";
import { queryBrainText, queryBrainVision } from "./brain.js";
import { startWebServer, handleReply } from "./server.js";
import { startVoiceListener, skipCurrentRecording, toggleManualRecording, toggleButtIn, forceSendLastTranscript } from "./audioLoop.js";
import { captureBase64 } from "./perception.js";

initOsc();
startWebServer(3030);
startVoiceListener();
console.log(`
Commands:
  !<text>    - send text-only message to Lily     (e.g. !hi)
  !+<text>   - screenshot + message to Lily        (e.g. !+what do you see)
  <space>    - while Lily is listening, skip the countdown and process now
  <backspace> - force-send whatever was last transcribed, no wake word or cooldown needed
  <enter>    - press on an empty line to start an untimed recording; press
               again to stop, transcribe, and send it -- bypasses the wake word
  b          - toggle ambient butt-in commentary on/off
Ctrl+C to quit.
`);

// output (and terminal:true) must be passed for readline to treat this as
// a real terminal -- without it, raw/keypress mode never turns on, so
// spacebar never fires (Enter still works because that's just a buffered
// line read, not a keypress).
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

// readline already puts a TTY stdin into keypress mode -- just listen in.
if (process.stdin.isTTY) {
  process.stdin.on("keypress", (str, key) => {
    if (key?.name === "space") {
      skipCurrentRecording();
    }
    if (key?.name === "b" && !key.ctrl && !key.meta) {
      toggleButtIn();
    }
    if (key?.name === "backspace") {
      forceSendLastTranscript();
    }
  });
}

rl.on("line", async (line) => {
  const raw = line.trim();

  if (raw === "") {
    toggleManualRecording();
    return;
  }

  if (!raw.startsWith("!")) {
    console.log("(ignored -- messages must start with ! or !+)");
    return;
  }

  let reply;
  if (raw.startsWith("!+")) {
    const text = raw.slice(2).trim();
    console.log("(capturing screenshot...)");
    const imageBase64 = await captureBase64();
    reply = await queryBrainVision(text, imageBase64);
  } else {
    const text = raw.slice(1).trim();
    reply = await queryBrainText(text);
  }

  handleReply(reply);
  console.log(`Lily: ${reply}`);
});

process.on("SIGINT", () => {
  console.log("\n[index] shutting down");
  process.exit(0);
});