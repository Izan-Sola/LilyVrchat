import readline from "readline";
import { initOsc } from "./osc.js";
import { queryBrainMessage } from "./brain.js";
import { triggerAvatarActionById } from "./avatarActions.js";
import { startWebServer, handleReply } from "./server.js";
import { startVoiceListener, skipCurrentRecording, toggleManualRecording, toggleButtIn, forceSendLastTranscript } from "./audioLoop.js";

initOsc();
startWebServer(3030);
startVoiceListener();
console.log(`
Commands:
  !<text>    - send text-only message to Lily     (e.g. !hi)
  !+<text>   - screenshot + message to Lily        (e.g. !+what do you see)
  <space>    - while Lily is listening, skip the countdown and process now
  <backspace> - force-send whatever was last transcribed, text-only, no wake word or cooldown needed
  <tab>      - same as backspace, but attaches a screenshot to the forced send
  1-8        - fire the matching avatar action directly over OSC (testing, bypasses the brain)
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
    if (key?.name === "tab") {
      forceSendLastTranscript(true);
    }
    if (key?.name && !key.ctrl && !key.meta && /^[1-8]$/.test(key.name)) {
      const result = triggerAvatarActionById(Number(key.name));
      console.log(`[test] ${result}`);
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

  // Every prompt now always carries a screenshot, so !text and !+text
  // behave the same -- !+ is kept around as a familiar alias.
  const text = raw.startsWith("!+") ? raw.slice(2).trim() : raw.slice(1).trim();
  console.log("(capturing screenshot...)");
  const reply = await queryBrainMessage("user", text, { withImage: true });

  handleReply(reply);
  console.log(`Lily: ${reply}`);
});

process.on("SIGINT", () => {
  console.log("\n[index] shutting down");
  process.exit(0);
});