import { getActionNames, triggerAvatarAction } from "./avatarActions.js";

// OpenAI-style function-calling schema, sent to the brain with every
// request so she can decide on her own when to use it.
export const TOOL_DEFINITIONS = [
  {
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
  },
];

// Dispatches an already-parsed tool call by name and returns the result
// string to feed back to the brain.
export async function runTool(name, args) {
  if (name === "trigger_avatar_action") {
    return triggerAvatarAction(args?.action);
  }
  return `Unknown tool "${name}".`;
}