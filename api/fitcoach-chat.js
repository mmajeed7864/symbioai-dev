import { createRetiredFitCoachHandler } from "./_fitcoach-retired.js";

export default createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-chat",
  replacement: "/api/fitcoach-chat-v3",
});
