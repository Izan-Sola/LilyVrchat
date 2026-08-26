import { setAxis, send, stopMovement } from "./osc.js";
import { say } from "./chatbox.js";
import { isTargetPresent, getProximity } from "./contactTracker.js";

const STATES = { IDLE: "idle", SEARCHING: "searching", FOLLOWING: "following" };
let state = STATES.IDLE;
let ticksSinceSeen = 0;
const LOST_THRESHOLD = 4;

export function decideAndAct() {
  const present = isTargetPresent();

  if (!present) {
    ticksSinceSeen++;
    stopMovement();
    if (ticksSinceSeen === LOST_THRESHOLD && state === STATES.FOLLOWING) {
      state = STATES.SEARCHING;
      say("wait, where'd you go?");
    } else if (ticksSinceSeen > LOST_THRESHOLD * 3 && state === STATES.SEARCHING) {
      state = STATES.IDLE;
    }
    return state;
  }

  ticksSinceSeen = 0;
  state = STATES.FOLLOWING;

  const proximity = getProximity();
  // No bearing signal available -- straight-line approach only.
  // Upgrade path: add 2-3 Contact Receivers at different body angles
  // on Lily's avatar (front/left/right), compare their signal strength
  // here to approximate a turn direction without any vision at all.
  send("/input/MoveForward", { type: "i", value: proximity < 0.6 ? 1 : 0 });
  return state;
}

export function getState() {
  return state;
}