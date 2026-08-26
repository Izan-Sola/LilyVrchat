import { exec } from "child_process";
import { readFile } from "fs/promises";
import cfg from "./config.js";

function captureScreen() {
  return new Promise((resolve, reject) => {
    exec(`spectacle -b -f -n -o ${cfg.SCREENSHOT_PATH}`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function captureBase64() {
    await captureScreen();
    const buf = await readFile(cfg.SCREENSHOT_PATH);
    return buf.toString("base64");
}