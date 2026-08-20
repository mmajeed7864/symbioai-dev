import { createRetiredFitCoachHandler } from "./_fitcoach-retired.js";

export default createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-chat-v2",
  replacement: "/api/fitcoach-chat-v3",
});
