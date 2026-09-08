import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { limitFitCoachAccount, limitFitCoachIp } from "../../api/_fitcoach-rate-limit.js";
import { startLocalRedis } from "./local-redis.mjs";

const env = Object.freeze({
  VERCEL: "1",
  UPSTASH_REDIS_REST_URL: "https://redis.test.invalid",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-local-test-token",
  FITCOACH_RATE_LIMIT_SECRET: "synthetic-local-test-secret-not-a-production-key",
});
let redis;
before(async () => {
  redis = await startLocalRedis();
  const info = await redis.command(["INFO", "server"]);
  assert.match(info, /redis_version:\d+\.\d+\.\d+/);
});
after(async () => {
  await redis?.stop();
});

function transport(commands = []) {
  return async (url, options) => {
    assert.equal(url, env.UPSTASH_REDIS_REST_URL);
    assert.equal(options.redirect, "error");
    const command = JSON.parse(options.body);
    commands.push(command);
    // The production-generated EVAL and arguments are executed unchanged. Only HTTPS
    // transport is substituted, never the Lua script, decision, counter, or clock.
    try {
      const result = await redis.command(command, options.signal);
      return { ok: true, json: async () => ({ result }) };
    } catch (error) {
      return { ok: true, json: async () => ({ error: error.message }) };
    }
  };
}

async function concurrent(count, action) {
  let next = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < count) {
        const i = next++;
        results[i] = await action(i);
      }
    })
  );
  return results;
}

test("the test database has no TCP listener or persistence and has a bounded memory budget", async () => {
  for (const [setting, value] of [
    ["port", "0"],
    ["save", ""],
    ["appendonly", "no"],
    ["unixsocketperm", "700"],
    ["maxmemory", String(32 * 1024 * 1024)],
  ])
    assert.deepEqual(await redis.command(["CONFIG", "GET", setting]), [setting, value]);
});

test("real Redis admits exactly 30 simultaneous sync writes across independent clients", async () => {
  const subject = randomUUID();
  const commands = [];
  const clients = Array.from({ length: 8 }, () => transport(commands));
  const results = await concurrent(80, (i) =>
    limitFitCoachAccount(subject, "sync_write", { env, fetchImpl: clients[i % 8] })
  );
  assert.equal(results.filter((result) => result.ok).length, 30);
  assert.equal(results.filter((result) => result.status === 429).length, 50);
  assert.equal(new Set(commands.map((command) => command[3])).size, 1);
  assert.equal(await redis.command(["GET", commands[0][3]]), "30");
  assert.ok(
    results
      .filter((result) => !result.ok)
      .every((result) => result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60)
  );
  assert.ok(commands.every((command) => !JSON.stringify(command).includes(subject)));
});

test("a shared network admits exactly 120 requests, including IPv4-mapped aliases", async () => {
  const fetchImpl = transport();
  const results = await concurrent(160, (i) =>
    limitFitCoachIp(
      { headers: { "x-vercel-forwarded-for": i % 2 ? "192.0.2.44" : "::ffff:c000:22c" } },
      { env, fetchImpl }
    )
  );
  assert.equal(results.filter((result) => result.ok).length, 120);
  assert.equal(results.filter((result) => result.status === 429).length, 40);
});

test("every operation uses its configured TTL and never grows a denied counter", async () => {
  for (const [scope, limit, windowMs] of [
    ["account", 120, 60_000],
    ["sync_read", 60, 60_000],
    ["sync_write", 30, 60_000],
    ["consent", 10, 600_000],
    ["export", 3, 900_000],
    ["delete", 3, 900_000],
    ["entitlements", 60, 60_000],
    ["subscription", 10, 600_000],
  ]) {
    const subject = randomUUID(),
      commands = [];
    const options = { env, fetchImpl: transport(commands) };
    assert.equal((await limitFitCoachAccount(subject, scope, options)).ok, true);
    const key = commands[0][3];
    const startedTtl = await redis.command(["PTTL", key]);
    assert.ok(startedTtl > windowMs - 5_000 && startedTtl <= windowMs);
    const results = await concurrent(limit + 5, () =>
      limitFitCoachAccount(subject, scope, options)
    );
    assert.equal(results.filter((result) => result.ok).length, limit - 1, scope);
    assert.equal(await redis.command(["GET", key]), String(limit));
    assert.ok(
      (await redis.command(["PTTL", key])) <= startedTtl,
      "denials must not restart expiration"
    );
  }
});

test("an actually expired bucket resets once, while a denied request does not extend it", async () => {
  const subject = randomUUID(),
    commands = [];
  const options = { env, fetchImpl: transport(commands) };
  for (let i = 0; i < 3; i++)
    assert.equal((await limitFitCoachAccount(subject, "export", options)).ok, true);
  const key = commands[0][3];
  // Shorten this owned test key only so the suite observes real expiry without a 15-minute wait.
  await redis.command(["PEXPIRE", key, 250]);
  const denied = await limitFitCoachAccount(subject, "export", options);
  assert.equal(denied.status, 429);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.ok((await redis.command(["PTTL", key])) <= 250);
  const deadline = Date.now() + 2_000;
  while ((await redis.command(["EXISTS", key])) && Date.now() < deadline) await delay(20);
  assert.equal(await redis.command(["EXISTS", key]), 0);
  const results = await concurrent(12, () => limitFitCoachAccount(subject, "export", options));
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.equal(results.filter((result) => result.status === 429).length, 9);
  assert.equal(await redis.command(["GET", key]), "3");
});

test("separate accounts and operations never spend each other's budgets", async () => {
  const subject = randomUUID(),
    other = randomUUID();
  const options = { env, fetchImpl: transport() };
  for (let i = 0; i < 3; i++) await limitFitCoachAccount(subject, "delete", options);
  assert.equal((await limitFitCoachAccount(subject.toUpperCase(), "delete", options)).status, 429);
  assert.equal((await limitFitCoachAccount(other, "delete", options)).ok, true);
  assert.equal((await limitFitCoachAccount(subject, "export", options)).ok, true);
});

test("malformed or immortal real Redis buckets fail closed without extending retention", async () => {
  for (const kind of ["no-expiry", "not-a-number", "negative", "list"]) {
    const subject = randomUUID(),
      commands = [];
    const options = { env, fetchImpl: transport(commands) };
    await limitFitCoachAccount(subject, "sync_read", options);
    const key = commands[0][3];
    if (kind === "no-expiry") await redis.command(["PERSIST", key]);
    if (kind === "not-a-number") await redis.command(["SET", key, "invalid", "PX", 60_000]);
    if (kind === "negative") await redis.command(["SET", key, "-1", "PX", 60_000]);
    if (kind === "list") {
      await redis.command(["DEL", key]);
      await redis.command(["LPUSH", key, "invalid"]);
      await redis.command(["PEXPIRE", key, 60_000]);
    }
    const result = await limitFitCoachAccount(subject, "sync_read", options);
    assert.deepEqual(result, { ok: false, status: 503, error: "ABUSE_PROTECTION_UNAVAILABLE" });
    if (kind === "no-expiry") assert.equal(await redis.command(["PTTL", key]), -1);
  }
});

test("losing the actual database socket fails closed rather than granting a local allowance", async () => {
  await redis.stop();
  const result = await limitFitCoachAccount(randomUUID(), "sync_write", {
    env,
    fetchImpl: transport(),
  });
  assert.deepEqual(result, { ok: false, status: 503, error: "ABUSE_PROTECTION_UNAVAILABLE" });
});
