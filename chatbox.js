import { send } from "./osc.js";

export function say(text, { immediate = true, sfx = false } = {}) {
  if (!text) return;
  const clipped = text.length > 144 ? text.slice(0, 141) + "..." : text;
  send("/chatbox/input", [
    { type: "s", value: clipped },
    { type: "i", value: immediate ? 1 : 0 },
    { type: "i", value: sfx ? 1 : 0 },
  ]);
}