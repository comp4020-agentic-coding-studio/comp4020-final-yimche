import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { marked } from "marked";
import { WebSocketServer, type WebSocket } from "ws";
import { store } from "./db.ts";
import { Game } from "./game.ts";

const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = 50;
const PUBLIC = join(import.meta.dirname, "..", "public");

const game = new Game({
  roundStarted: (seed, ids) => store.startRound(seed, ids),
  roundEnded: (id, winner) => store.endRound(id, winner),
  caught: (round, catcher, caught) => store.recordCatch(round, catcher, caught),
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function readmePage(): string {
  const body = marked.parse(readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8"));
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About · Torchlight</title><link rel="stylesheet" href="/style.css"></head>
<body class="readme"><main><p><a href="/">← Back to the maze</a></p>${body}</main></body></html>`;
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function serveStatic(res: ServerResponse, root: string, path: string): boolean {
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) return false;
  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
  return true;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1000) throw new Error("body too large");
  }
  return data;
}

// A name is all it takes to play: 1–16 printable characters, trimmed.
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\p{C}]/gu, "").trim().slice(0, 16);
  return name.length > 0 ? name : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const sid = cookies(req).sid;
  const player = sid ? store.getPlayer(sid) : undefined;

  if (url.pathname === "/readme" || url.pathname === "/readme/") {
    res.writeHead(200, { "content-type": TYPES[".html"] });
    return res.end(readmePage());
  }
  if (url.pathname.startsWith("/readme/docs/")) {
    if (serveStatic(res, join(import.meta.dirname, "..", "docs"), url.pathname.slice("/readme/docs/".length))) return;
  }
  if (url.pathname === "/api/me" && req.method === "GET") {
    if (!player) return json(res, 404, { error: "no name yet" });
    return json(res, 200, { id: player.id, ...store.record(player.id) });
  }
  if (url.pathname === "/api/name" && req.method === "POST") {
    let name: string | null = null;
    try {
      name = cleanName(JSON.parse(await readBody(req)).name);
    } catch {
      // falls through to the 400
    }
    if (!name) return json(res, 400, { error: "a name is 1 to 16 characters" });
    const id = player?.id ?? randomBytes(16).toString("hex");
    store.savePlayer(id, name);
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    return json(res, 200, { id, name }, {
      "set-cookie": `sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    });
  }
  if (url.pathname === "/api/board") {
    return json(res, 200, { leaders: store.leaderboard(), recent: store.recentCatches() });
  }
  if (serveStatic(res, PUBLIC, url.pathname === "/" ? "index.html" : url.pathname)) return;
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

// One socket per player: a second tab takes over from the first.
const sockets = new Map<string, WebSocket>();
const sent = new WeakMap<WebSocket, { roster: number; round: number }>();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const sid = cookies(req).sid;
  const player = sid ? store.getPlayer(sid) : undefined;
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws" || !player) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.get(player.id)?.close(4000, "opened in another tab");
    sockets.set(player.id, ws);
    store.touch(player.id);
    game.join(player.id, player.name, Date.now());
    ws.send(JSON.stringify({ t: "hello", id: player.id, name: player.name }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.t === "input") {
          const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
          const aim = typeof msg.aim === "number" && Number.isFinite(msg.aim) ? msg.aim : null;
          game.setInput(player.id, num(msg.dx), num(msg.dy), aim);
        }
      } catch {
        // ignore anything that isn't our protocol
      }
    });
    ws.on("close", () => {
      if (sockets.get(player.id) === ws) {
        sockets.delete(player.id);
        game.leave(player.id, Date.now());
      }
    });
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const events = game.tick(now, Math.min(0.1, (now - last) / 1000));
  last = now;
  const names = (id: string) => game.players.get(id)?.name ?? "someone";
  const feed = events.map((e) => JSON.stringify({ t: "catch", catcher: names(e.catcher), caught: names(e.caught) }));
  const roster = JSON.stringify(game.roster());
  const round = JSON.stringify(game.round());
  for (const [id, ws] of sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    const seen = sent.get(ws) ?? { roster: -1, round: -1 };
    if (seen.round !== game.roundVersion) ws.send(round);
    if (seen.roster !== game.rosterVersion) ws.send(roster);
    sent.set(ws, { roster: game.rosterVersion, round: game.roundVersion });
    for (const f of feed) ws.send(f);
    ws.send(JSON.stringify(game.viewFor(id, now)));
  }
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => console.log(`listening on :${PORT}`));
