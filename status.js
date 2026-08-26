import { say } from "./chatbox.js";

const TITLE = "[I'm AI, check profile for details or ask ShinyShadow_]";

// Pushes a two-line status update to the VRChat chatbox: the fixed title
// on top, and whatever's happening right now underneath -- mirrors the
// terminal logs (listening countdown, processing, thinking, reply, ...).
export function setStatus(line) {
  say(`${TITLE}\n${line}`);
}