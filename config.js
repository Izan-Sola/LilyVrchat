export default {
  VRCHAT_SEND_PORT: 9000,
  VRCHAT_SEND_ADDRESS: "127.0.0.1",
  LOCAL_LISTEN_PORT: 9001,
  BRAIN_URL: "http://192.168.18.48:11435/v1/chat/completions",
  SCREENSHOT_PATH: "/tmp/lily_vr_frame.png",
BUTTIN_MIN_MS: 60000,
BUTTIN_MAX_MS: 120000,
  // Voice listening
  PYTHON_BIN: "/home/izansolaserver/Desktop/lilyvrchatstuff/.venv/bin/python3",
  AUDIO_MONITOR_SOURCE: "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", // run `pactl list sources short` if this doesn't work
  AUDIO_CHUNK_SECONDS: 5,
  WHISPER_MODEL: "base.en", // no longer used locally -- kept as a reminder of the old setting. Model choice now lives in whisper_server.py on the Zorin PC
  WHISPER_SERVER_URL: "http://192.168.18.48:8775/transcribe", // faster-whisper GPU server on the Zorin PC
 VOICE_WAKE_WORD: ["little", "lee", "lily", "lili", "lilly", "lilí", "really", "leally", "leeli", "lil"], // was a single string
};