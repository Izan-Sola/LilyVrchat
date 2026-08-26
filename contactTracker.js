// contactTracker.js
import { onOscMessage } from "./osc.js";
import cfg from "./config.js";

let currentSignal = 0;

export function initContactTracker() {
    const targetParam = cfg.FOLLOW_TARGETS[cfg.ACTIVE_FOLLOW_TARGET];
    if (!targetParam) {
        console.warn(`[contact] no param configured for target "${cfg.ACTIVE_FOLLOW_TARGET}"`);
        return;
    }

    onOscMessage((msg) => {
        if (msg.address === targetParam) {
            currentSignal = msg.args[0]?.value ?? msg.args[0] ?? 0;
        }
    });

    console.log(`[contact] tracking ${cfg.ACTIVE_FOLLOW_TARGET} via ${targetParam}`);
}

// present: is the target close enough to count as "here"
export function isTargetPresent() {
    return currentSignal >= cfg.FOLLOW_SIGNAL_THRESHOLD;
}

// raw 0-1 proximity, from the receiver's Proximity output in Unity
export function getProximity() {
    return currentSignal;
}