import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  ["OpenAI/OpenRouter", /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{20,}\b/g],
  ["DeepSeek", /\bsk-[a-f0-9]{24,}\b/gi],
  ["GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["Google API", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Telegram bot", /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const files = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith("package-lock.json") &&
      !file.endsWith(".png") &&
      !file.endsWith(".jpg") &&
      !file.endsWith(".jpeg") &&
      !file.endsWith(".gif") &&
      !file.endsWith(".webp") &&
      !file.endsWith(".mp4") &&
      !file.endsWith(".pdf")
  );

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${file}: possible ${label} credential`);
  }
}

if (findings.length) {
  console.error("Potential committed credentials found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Credential-pattern scan passed across ${files.length} tracked text files.`);
