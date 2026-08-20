# FitCoach trainer provider v3

Status: private synthetic founder research. This route is not approved for real-user health data, public accounts, medical advice, plan mutation, or production voice upload.

Production endpoint: `/api/fitcoach-chat-v3`. The earlier FitCoach endpoints remain temporary migration surfaces only and must be retired after the founder PWA has moved to v3.

## Product contract

The deterministic FitCoach layer owns safety, the selected intervention, plan facts, memory, and any later plan approval. The model is a copy renderer: it may phrase an already-approved coaching response, but it cannot choose an action, write memory, activate a plan, diagnose, clear someone to train, or make a safety decision.

The request is rejected unless it is an exact `synthetic_low_sensitivity` envelope. The provider projection contains only allow-listed ordinary training codes and small counts. It excludes names, profile IDs, bodyweight, conditions, medication, raw plans, raw workout history, memory, and audio. Safety and private-data interception happen before any provider request. Intercepted text is not persisted and is never sent to text-to-speech.

## Direct provider order

1. DeepSeek: `deepseek-v4-flash` at `https://api.deepseek.com/chat/completions`
2. Qwen Model Studio US: `qwen3.6-flash-2026-04-16` at `https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions`
3. Reviewed deterministic local copy

Quick, Balanced, and Deep change response length only. They never change provider priority, facts, safety, or the approved action. Failover occurs only for timeouts, HTTP 429, and provider 5xx responses. Authentication, malformed output, unsafe output, or a privacy rejection stops cross-provider egress and uses local copy.

## Server configuration

Keep every key in the server environment. A browser or Chrome login is not an API credential and must not be copied into client JavaScript, Git, screenshots, or chat.

- `DEEPSEEK_API_KEY`: enables the primary provider.
- `DASHSCOPE_API_KEY`: enables the direct Qwen US backup.
- `FITCOACH_DEEPSEEK_MODEL`: optional allow-listed override to `deepseek-v4-pro`; Flash remains the default.

Model URLs are fixed in code so environment variables cannot redirect trainer data to an arbitrary host. Moonshot/Kimi and OpenRouter variables are intentionally ignored by this route.

The endpoint uses the existing Redis-backed IP/session rate limits and Symbio monthly AI budget reservation ledger. When provider configuration, budget protection, or the monthly budget is unavailable, it returns reviewed local trainer copy without making a provider request.

## Privacy gate

DeepSeek's current privacy terms say its service is not intended for sensitive data such as health data and describe model-improvement use and processing/storage in China. Qwen Model Studio publishes a no-training statement and a US region, but real-user activation still needs retention, DPA, consent, and legal review.

Therefore the current route fails closed for `real_user` classification and accepts only synthetic, low-sensitivity founder prompts. Do not bypass this gate to test a real profile.

Official references:

- DeepSeek API: https://api-docs.deepseek.com/api/create-chat-completion/
- DeepSeek privacy: https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
- Qwen3.6 Flash: https://www.alibabacloud.com/help/en/model-studio/qwen3-6-flash
- Model Studio privacy: https://www.alibabacloud.com/help/en/model-studio/privacy-notice

## Voice and presentation

The founder PWA uses device speech recognition and device speech synthesis. It does not upload raw voice audio through the FitCoach API. Nova, Atlas, and Sage are device-voice preferences; availability depends on the phone or browser. Supportive, Direct, Strict, and Competitive change wording guidance and bounded speech rate/pitch, but never safety or plan semantics. Strict must remain firm without shame, punishment, unsafe escalation, or pressure to ignore pain or rest.

## Verification

Run the repository tests and secret scan before any provider activation. The FitCoach suite covers the 43-case safety floor, exact request and provider contracts, DeepSeek-first routing under every mode, direct Qwen failover, rejection of Kimi/OpenRouter configuration, timeouts, oversized and unsafe output, projection leakage, and deterministic personality fallback.

Still required before any real-user or public release: independent provider privacy approval, authenticated identity, real phone testing, end-to-end server deployment verification, and explicit plan-diff approval/rollback wiring.
