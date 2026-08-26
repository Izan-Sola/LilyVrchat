import osc from "osc";
import cfg from "./config.js";

let port = null;
const listeners = [];

export function initOsc() {
  port = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: cfg.LOCAL_LISTEN_PORT,
    remoteAddress: cfg.VRCHAT_SEND_ADDRESS,
    remotePort: cfg.VRCHAT_SEND_PORT,
  });

  port.on("ready", () => {
    console.log(`[osc] ready, sending to ${cfg.VRCHAT_SEND_ADDRESS}:${cfg.VRCHAT_SEND_PORT}`);
  });
  port.on("message", (msg) => listeners.forEach((fn) => fn(msg)));
  port.on("error", (err) => console.error("[osc] error:", err));

  port.open();
  return port;
}

export function onOscMessage(fn) {
  listeners.push(fn);
}

export function send(address, args = []) {
  if (!port) throw new Error("OSC port not initialized -- call initOsc() first");
  port.send({ address, args });
}