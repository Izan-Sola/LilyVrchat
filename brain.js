import cfg from "./config.js";
import { SYSTEM_PROMPT } from "./prompts.js";

async function callBrain(userContent) {
    const res = await fetch(cfg.BRAIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userContent },
            ],
            // no `tools` key at all -- nothing offered, nothing to call
        }),
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    // strip any stray <think> tags the same way lily.js does, just in case
    return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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