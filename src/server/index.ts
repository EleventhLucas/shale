import { serveStatic } from "hono/bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db";

const config = loadConfig();
const db = openDatabase(config.dataDir);
const app = createApp(db, config);

app.get("/assets/*", serveStatic({ root: "./dist/web" }));
app.get("/shale-mark.png", serveStatic({ root: "./dist/web" }));
app.get("*", serveStatic({ path: "./dist/web/index.html" }));

const server = Bun.serve({
  port: config.port,
  fetch(request, server) {
    if (new URL(request.url).pathname === "/_shale/events") {
      server.timeout(request, 0);
    }
    return app.fetch(request);
  },
});

console.log(`Shale server listening on http://localhost:${server.port}`);

function shutdown(): void {
  server.stop(true);
  db.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
