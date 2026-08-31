import cfg from "../util/config.js";
import { getSystemPrompt, getButtInSystemPrompt } from "./prompts.js";
import { captureBase64 } from "./perception.js";
import { TOOL_DEFINITIONS, runTool } from "./tools.js";

const MAX_RETRIES = 4; // retries for empty/malformed replies
const MAX_TOOL_ITERATIONS = 3; // cap on chained tool calls before we give up and just reply
const FALLBACK_REPLY = "... (•ᴗ•)";

export function fixEscapedApostrophes(text) {
  return text.replace(/'/g, "");
}

function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function stripToolCallBlocks(text) {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

function safeParseJSON(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Tool calls can show up in two shapes depending on how the brain server
// handles the `tools` we send: a proper OpenAI-style `message.tool_calls`
// array, or (common with local Qwen/Hermes-style models) a raw
// `<tool_call>{"name": ..., "arguments": ...}</tool_call>` block inside
// the text content. Normalize both into the same shape here.
function extractToolCalls(msg, rawContent) {
  if (msg?.tool_calls?.length) {
    return msg.tool_calls.map((tc, i) => ({
      id: tc.id ?? `native_${i}`,
      native: true,
      name: tc.function?.name,
      arguments: safeParseJSON(tc.function?.arguments) ?? {},
    }));
  }

  const blocks = [...rawContent.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)];
  return blocks
    .map((match, i) => {
      const parsed = safeParseJSON(match[1].trim()) ?? {};
      return {
        id: `text_${i}`,
        native: false,
        name: parsed.name,
        arguments: parsed.arguments ?? parsed.parameters ?? {},
      };
    })
    .filter((tc) => tc.name); // drop anything we couldn't parse a name out of
}

async function callBrainOnce(messages, overrides = {}) {
  const res = await fetch(cfg.BRAIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools: TOOL_DEFINITIONS, ...overrides }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message ?? null;
}

// Feeds executed tool call results back into the conversation, in
// whichever convention matches how the calls came in: real tool_calls get
// the standard OpenAI assistant+tool message pair; text-based <tool_call>
// blocks get fed back the way Qwen-style models expect their own
// tool-call convention to continue.
function buildToolFollowupMessages(msg, toolCalls, results) {
  const followups = [];

  if (toolCalls.some((tc) => tc.native)) {
    followups.push({
      role: "assistant",
      content: msg?.content ?? "",
      tool_calls: msg.tool_calls,
    });
    toolCalls.forEach((tc, i) => {
      if (tc.native) {
        followups.push({ role: "tool", tool_call_id: tc.id, content: results[i] });
      }
    });
  } else {
    followups.push({ role: "assistant", content: msg?.content ?? "" });
    toolCalls.forEach((tc, i) => {
      followups.push({
        role: "user",
        content: `<tool_response>\n${JSON.stringify({ name: tc.name, content: results[i] })}\n</tool_response>`,
      });
    });
  }

  return followups;
}

async function callBrain(userContent, systemPrompt = getSystemPrompt()) {
  const baseMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let scratch = [];
  let malformedRetries = 0;
  let toolIterations = 0;

  while (true) {
    const messages = [...baseMessages, ...scratch];

    const overrides = malformedRetries > 0
      ? { repeat_penalty: 1.1 + malformedRetries * 0.1, stop: ["</answer>", "<|user|>", "<|endoftext|>"] }
      : {};

    const msg = await callBrainOnce(messages, overrides);
    const raw = stripThink(msg?.content ?? "");
    const toolCalls = extractToolCalls(msg, raw);

    if (toolCalls.length && toolIterations < MAX_TOOL_ITERATIONS) {
      toolIterations++;
      const results = await Promise.all(toolCalls.map((tc) => runTool(tc.name, tc.arguments)));
      scratch = [...scratch, ...buildToolFollowupMessages(msg, toolCalls, results)];
      continue;
    }

    const content = stripToolCallBlocks(raw);
    if (content && content.toLowerCase() !== "none") {
      return fixEscapedApostrophes(content);
    }
    if (content.toLowerCase() === "none") {
      return "NONE"; // deliberate silence, not a failure -- propagate as-is
    }

    malformedRetries++;
    if (malformedRetries > MAX_RETRIES) break;

    scratch = [
      ...scratch,
      { role: "assistant", content: msg?.content ?? "" },
      { role: "user", content: "[System: Reply naturally and in character to the user's message.]" },
    ];
  }

  return fixEscapedApostrophes(FALLBACK_REPLY);
}

export async function queryBrainText(userText) {
  return callBrain(userText);
}

export async function queryBrainVision(userText, imageBase64, systemPrompt = getSystemPrompt()) {
  return callBrain([
    { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    { type: "text", text: userText },
  ], systemPrompt);
}

export async function queryBrainButtIn(transcriptText) {
  return callBrain(transcriptText, getButtInSystemPrompt());
}

// -- Unified entry point for every prompt sent to the brain -------------
// Prompts are tagged with who's actually talking so Lily can tell direct
// address apart from overheard chatter. `situation` is "user" (default --
// someone talking to her directly, whatever the input method) or
// "ambient" (butt-in commentary on a conversation she wasn't addressed
// in). Screenshots are opt-in via `withImage` -- attaching one on every
// turn made live voice back-and-forth too slow, so callers only ask for
// one when they actually need visual context.
const SITUATION_PREFIXES = {
  user: "User is saying:",
  ambient: "People around are saying:",
};

export async function queryBrainMessage(situation, text, { withImage = false } = {}) {
  const prefix = SITUATION_PREFIXES[situation] ?? SITUATION_PREFIXES.user;
  const systemPrompt = situation === "ambient" ? getButtInSystemPrompt() : getSystemPrompt();

  if (!withImage) {
    return callBrain(`${prefix} ${text}`, systemPrompt);
  }

  let imageBase64 = null;
  try {
    imageBase64 = await captureBase64();
  } catch (err) {
    console.error(`[brain] screenshot capture failed, falling back to text-only: ${err.message}`);
  }

  if (!imageBase64) {
    return callBrain(`${prefix} ${text}`, systemPrompt);
  }

  const content = `${prefix} ${text}\n\n(This is an image of what you currently see.)`;
  return queryBrainVision(content, imageBase64, systemPrompt);
}