import { createRetiredFitCoachHandler } from "./_fitcoach-retired.js";

const retiredChatHandler = createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-chat",
  replacement: "/api/fitcoach-chat-v3",
});

const retiredTranscribeHandler = createRetiredFitCoachHandler({
  endpoint: "/api/fitcoach-transcribe",
  replacement: "browser-or-device-dictation",
});

export default function retiredFitCoachRouter(req, res) {
  return req.query?.fitcoach_retired === "transcribe"
    ? retiredTranscribeHandler(req, res)
    : retiredChatHandler(req, res);
}
