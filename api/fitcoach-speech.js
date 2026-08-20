import { createRetiredFitCoachHandler } from "./_fitcoach-retired.js";

export default createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-speech",
  replacement: "browser-or-device-speech",
});
