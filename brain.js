import cfg from "./config.js";
import { SYSTEM_PROMPT, BUTTIN_SYSTEM_PROMPT } from "./prompts.js";

const MAX_RETRIES = 4;
const FALLBACK_REPLY = "... (•ᴗ•)";

function looksLikeToolCall(msg, rawContent) {
  if (msg?.tool_calls?.length) return true;
  return rawContent.includes("<tool_call>");
}

export function fixEscapedApostrophes(text) {
  return text.replace(/'/g, "");
}

function stripThink(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function stripToolCallBlocks(text) {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

async function callBrainOnce(messages, overrides = {}) {
  const res = await fetch(cfg.BRAIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...overrides }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message ?? null;
}

async function callBrain(userContent, systemPrompt = SYSTEM_PROMPT) {
  const baseMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let scratch = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const messages = [...baseMessages, ...scratch];

    if (attempt > 0) {
      messages.push({
        role: "user",
        content: "[System: You have no tools available right now. Stop attempting to call any tool this turn, and reply naturally and in character to the user's message.]",
      });
    }

    const overrides = attempt > 0
      ? { repeat_penalty: 1.1 + attempt * 0.1, stop: ["</answer>", "<|user|>", "<|endoftext|>", "<tool_call>"] }
      : {};

    const msg = await callBrainOnce(messages, overrides);
    const raw = stripThink(msg?.content ?? "");

    if (!looksLikeToolCall(msg, raw)) {
      const content = stripToolCallBlocks(raw);
      if (content && content.toLowerCase() !== "none") {
        return fixEscapedApostrophes(content);
      }
      if (content.toLowerCase() === "none") {
        return "NONE"; // deliberate silence, not a failure -- propagate as-is
      }
    }

    scratch = [...scratch, { role: "assistant", content: msg?.content ?? "" }];
  }

  return fixEscapedApostrophes(FALLBACK_REPLY);
}

export async function queryBrainText(userText) {
  return callBrain(userText);
}

export async function queryBrainVision(userText, imageBase64) {
  return callBrain([
    { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    { type: "text", text: userText },
  ]);
}

export async function queryBrainButtIn(transcriptText) {
  return callBrain(transcriptText, BUTTIN_SYSTEM_PROMPT);
}