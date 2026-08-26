export default {
  VRCHAT_SEND_PORT: 9000,
  VRCHAT_SEND_ADDRESS: "127.0.0.1",
  LOCAL_LISTEN_PORT: 9001,
  BRAIN_URL: "http://192.168.18.48:11435/v1/chat/completions",
  SCREENSHOT_PATH: "/tmp/lily_vr_frame.png",
BUTTIN_MIN_MS: 30000,
BUTTIN_MAX_MS: 120000,
  // Voice listening
  AUDIO_MONITOR_SOURCE: "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", // run `pactl list sources short` if this doesn't work
  AUDIO_CHUNK_SECONDS: 5,
  WHISPER_MODEL: "tiny.en", // tiny.en = faster/less accurate, small.en = slower/more accurate
 VOICE_WAKE_WORD: ["lily", "lili", "lilly", "lilí", "really", "leally", "leeli", "lil"], // was a single string
};