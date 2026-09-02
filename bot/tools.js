import { getActionNames, triggerAvatarAction } from "./avatarActions.js";
import { captureBase64 } from "./perception.js";
import cfg from "../util/config.js";

const AVATAR_ACTION_TOOL = {
  type: "function",
  function: {
    name: "trigger_avatar_action",
    description:
      "Play one of your avatar's built-in physical actions in VRChat (waving, dancing, etc). Use it when it actually fits the moment -- don't force it into every reply. Looping actions (like dancing) stop themselves automatically after a few seconds, no need to stop them yourself.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: getActionNames(),
          description: "Which action to play.",
        },
      },
      required: ["action"],
    },
  },
};

const SCREENSHOT_TOOL = {
  type: "function",
  function: {
    name: "capture_screenshot",
    description:
      "Take a screenshot of what you're currently seeing in VRChat and look at it. Use this when you actually need visual info to answer -- someone asking what you see, asking about their avatar/outfit, asking you to describe the world, etc. Don't use it for things that don't need eyes.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

// Read live (not frozen at import time) so flipping ALWAYS_APPEND_SCREENSHOT
// in config.json takes effect without a restart -- config.js already
// live-reloads the file. When every message already carries a screenshot,
// the tool is redundant (and just tempts the model into calling it
// needlessly on top of the one it's already getting), so it's dropped
// from the list entirely rather than left in unused.
export function getToolDefinitions() {
  const tools = [AVATAR_ACTION_TOOL];
  if (!cfg.ALWAYS_APPEND_SCREENSHOT) {
    tools.push(SCREENSHOT_TOOL);
  }
  return tools;
}

// Dispatches an already-parsed tool call by name and returns the result to
// feed back to the brain. Most tools return a plain string; the screenshot
// tool returns { text, image } instead, since tool-result slots are
// text-only in both calling conventions brain.js supports -- the caller is
// responsible for attaching `image` as an actual image message.
export async function runTool(name, args) {
  if (name === "trigger_avatar_action") {
    return triggerAvatarAction(args?.action);
  }
  if (name === "capture_screenshot") {
    try {
      const image = await captureBase64();
      return { text: "Screenshot captured -- look at the attached image.", image };
    } catch (err) {
      return `Screenshot failed: ${err.message}`;
    }
  }
  return `Unknown tool "${name}".`;
}
