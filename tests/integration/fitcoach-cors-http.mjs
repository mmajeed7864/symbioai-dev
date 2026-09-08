import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import coach from "../../api/fitcoach-chat-v3.js";
import speech from "../../api/fitcoach-speech-v2.js";
import { createFitCoachPlatformConfigHandler } from "../../api/_fitcoach-platform-config-route-v1.js";
import { createFitCoachPlatformRouter } from "../../api/fitcoach-platform-v1.js";

// Real HTTP transport over the production handlers. Only config uses an empty
// environment; it must never advertise the developer's real account settings.
// Exercise this fixture only with OPTIONS, config GET or invalid POST envelopes.
export async function startFitCoachCorsFixture({ port = 0 } = {}) {
  const requests = [];
  const config = createFitCoachPlatformConfigHandler({ env: {} });
  const handlers = {
    "/api/fitcoach-chat-v3": coach,
    "/api/fitcoach-speech-v2": speech,
    "/api/fitcoach-platform-config-v1": config,
    "/api/fitcoach-platform-v1": createFitCoachPlatformRouter({ handlers: { config } }),
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const record = { method: req.method, path: url.pathname, origin: req.headers.origin || null };
    requests.push(record);
    res.on("finish", () => {
      record.status = res.statusCode;
    });
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>FitCoach connection check</title><h1>FitCoach connection check</h1><p>Local transport test only. No accounts, workouts or provider calls.</p>'
      );
      return;
    }
    const handler = handlers[url.pathname];
    if (!handler) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (
      url.pathname === "/api/fitcoach-platform-v1" &&
      url.searchParams.get("fitcoach_route") !== "config"
    ) {
      res.writeHead(400);
      res.end();
      return;
    }
    let raw = "";
    try {
      for await (const chunk of req) {
        raw += chunk.toString();
        if (raw.length > 1000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
    } catch {
      if (!res.headersSent) res.statusCode = 400;
      res.end();
      return;
    }
    // No well-formed provider request or real credential may enter this harness.
    const safeRead = (req.method === "OPTIONS" || req.method === "GET") && raw === "";
    const invalidPost = req.method === "POST" && raw === "{}";
    if (req.headers.authorization || req.headers.cookie || (!safeRead && !invalidPost)) {
      res.writeHead(400);
      res.end();
      return;
    }
    req.body = invalidPost ? {} : undefined;
    req.query = Object.fromEntries(url.searchParams);
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return res;
    };
    try {
      await handler(req, res);
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await startFitCoachCorsFixture({ port: Number(process.argv[2] || 4186) });
  console.log(JSON.stringify({ listening: fixture.baseUrl, syntheticOnly: true }));
  const finish = async () => {
    await fixture.close();
    console.log(JSON.stringify({ requests: fixture.requests }));
    process.exit(0);
  };
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
}
