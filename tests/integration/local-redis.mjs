import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Test-only RESP2 transport. Never connects to configured production Redis or a TCP port.
// Each command uses a separate connection, so concurrent callers exercise Redis serialization.
function parse(buffer, start = 0) {
  const end = buffer.indexOf("\r\n", start);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[start]);
  const line = buffer.toString("utf8", start + 1, end);
  let next = end + 2;
  if (type === "+") return { value: line, next };
  if (type === "-") throw new Error(`redis_test_reply:${line}`);
  if (type === ":") return { value: Number(line), next };
  const length = Number(line);
  if (!Number.isSafeInteger(length) || length < -1) throw new Error("invalid_test_resp");
  if (length === -1) return { value: null, next };
  if (type === "$") {
    if (buffer.length < next + length + 2) return null;
    return { value: buffer.toString("utf8", next, next + length), next: next + length + 2 };
  }
  if (type === "*") {
    const value = [];
    for (let i = 0; i < length; i++) {
      const item = parse(buffer, next);
      if (!item) return null;
      value.push(item.value);
      next = item.next;
    }
    return { value, next };
  }
  throw new Error("unsupported_test_resp");
}

export function redisCommand(socketPath, args, signal) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const socket = createConnection({ path: socketPath });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new Error("redis_test_aborted"));
    socket.setTimeout(2_000, () => finish(new Error("redis_test_timeout")));
    socket.on("error", finish);
    socket.on("end", () => finish(new Error("redis_test_incomplete_reply")));
    socket.on("connect", () => {
      const parts = args.map((value) => Buffer.from(String(value)));
      socket.write(
        Buffer.concat([
          Buffer.from(`*${parts.length}\r\n`),
          ...parts.flatMap((value) => [
            Buffer.from(`$${value.length}\r\n`),
            value,
            Buffer.from("\r\n"),
          ]),
        ])
      );
    });
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 1_048_576) return finish(new Error("redis_test_reply_too_large"));
      try {
        const parsed = parse(bytes);
        if (parsed) finish(null, parsed.value);
      } catch (error) {
        finish(error);
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function startLocalRedis() {
  // Short path also fits macOS's Unix-socket path limit; mkdtemp owns this directory.
  const directory = await mkdtemp("/tmp/fitcoach-redis-");
  const socketPath = join(directory, "redis.sock");
  const child = spawn(
    process.env.FITCOACH_TEST_REDIS_SERVER || "redis-server",
    [
      "--port",
      "0",
      "--unixsocket",
      socketPath,
      "--unixsocketperm",
      "700",
      "--save",
      "",
      "--appendonly",
      "no",
      "--daemonize",
      "no",
      "--maxmemory",
      "32mb",
      "--maxmemory-policy",
      "noeviction",
      "--dir",
      directory,
      "--loglevel",
      "warning",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let spawnError = null;
  let output = "";
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-2_000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-2_000);
  });
  const command = (args, signal) => redisCommand(socketPath, args, signal);
  const stop = async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, delay(2_000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    // Only this fixture's fresh, private, disposable directory; never a user/remote database.
    await rm(directory, { recursive: true, force: true });
  };
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null) break;
    try {
      if ((await command(["PING"])) === "PONG") return { command, stop, socketPath };
    } catch {
      /* The owned process is still starting; do not start a replacement. */
    }
    await delay(25);
  }
  await stop();
  throw new Error(
    `Local Redis did not start. Set FITCOACH_TEST_REDIS_SERVER to an installed executable. ${spawnError?.message || output}`
  );
}
