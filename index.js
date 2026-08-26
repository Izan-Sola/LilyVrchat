import readline from "readline";
import { initOsc } from "./osc.js";
import { say } from "./chatbox.js";
import { queryBrainText, queryBrainVision } from "./brain.js";
import { startWebServer, showIdleMessage } from "./server.js";
import { startVoiceListener } from "./audioLoop.js";

initOsc();
startWebServer(3030);
startVoiceListener();
console.log(`
Commands:
  !<text>    - send text-only message to Lily     (e.g. !hi)
  !+<text>   - screenshot + message to Lily        (e.g. !+what do you see)
Ctrl+C to quit.
`);

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const raw = line.trim();
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

  say(reply);
  console.log(`Lily: ${reply}`);
});

process.on("SIGINT", () => {
  console.log("\n[index] shutting down");
  process.exit(0);
});