import { createRetiredFitCoachHandler } from "./_fitcoach-retired.js";

export default createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-transcribe",
  replacement: "browser-or-device-dictation",
});
