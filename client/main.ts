import {
  AURA_RADIUS,
  BEAM_HALF_ANGLE,
  BEAM_RANGE,
  BLACKOUT_REACH,
  FLASH_MS,
  FREEZE_MS,
  PLAYER_RADIUS,
  SPEED_MS,
  XRAY_MS,
  castRay,
  fallDepth,
  type Kind,
  type Maze,
} from "../shared/world.ts";

type Phase = "waiting" | "countdown" | "playing" | "ended";
type Status = "alive" | "caught" | "spectating";
type Mode = "ffa" | "teams" | "duel";
type Team = "red" | "blue";
interface Seen {
  id: string;
  x: number;
  y: number;
  facing: number;
  cooldownMs: number;
  cooldownHeld: boolean;
  xray: boolean;
  frozen: boolean;
  dimmed: boolean;
}
interface State {
  phase: Phase;
  remainingMs: number;
  flashMs: number;
  nextFlashMs: number;
  me?: {
    x: number;
    y: number;
    facing: number;
    status: Status;
    lit: boolean;
    cooldownMs: number;
    cooldownHeld: boolean;
    item: Kind | null;
    speedMs: number;
    xrayMs: number;
    frozenMs: number;
    dimmedMs: number;
    decoy: { x: number; y: number; facing: number; ms: number } | null;
  };
  zone: { x: number; y: number; r: number; closesInMs: number } | null;
  others: Seen[];
  pickups: { id: number; kind: Kind; x: number; y: number }[];
}
interface RosterEntry {
  id: string;
  name: string;
  status: Status;
  away: boolean;
  guest: boolean;
  team: Team | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("maze");
const ctx = canvas.getContext("2d")!;
const fog = document.createElement("canvas");
const fctx = fog.getContext("2d")!;

let myId = "";
let hostId: string | null = null;
// the room is in the link, so sharing the page shares the room
let room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
let maze: Maze = { w: 1, h: 1, rows: ["#"] };
let state: State | null = null;
let roster: RosterEntry[] = [];
let winner: string | null = null;
let winnerTeam: Team | null = null;
let mode: Mode = "ffa";
// the hand-made map the host picked for the room, or null for a fresh maze
let roomMap: { id: number; name: string } | null = null;
const MODE_NAMES: Record<Mode, string> = { ffa: "Free for all", teams: "Teams", duel: "One v one" };
const TEAM_NAMES: Record<Team, string> = { red: "Red", blue: "Blue" };
// The night the maze is drawn in, and a colour for each player so you can
// tell who's who in the dark. A player's colour comes from their id, so it's
// the same on every screen and from round to round.
const NIGHT = { floor: "#46536f", grout: "#3a4660", wall: "#121722", edge: "#5a6888", void: "#04050a", light: "255 236 196" };
const PLAYER_COLOURS = ["#5cc8d8", "#f08a6c", "#9b8cf0", "#7fd08a", "#f0a3c8", "#e8c46a", "#6ea8f5", "#d4d4dc"];
const KIND_COLOURS: Record<Kind, string> = { speed: "#3fbf85", xray: "#9a82f0", teleport: "#ec6ea4", freeze: "#bfeaff", decoy: "#e8b04a", blackout: "#e8574e" };
// frost: the pale blue a frozen player and their stuck beam are tinted with
const ICE = "200 238 255";
const TEAM_COLOURS: Record<Team, string> = { red: "#f08a6c", blue: "#6ea8f5" };
// In teams, everyone wears their side's colour, so friend and rival read at a glance.
function colourOf(id: string): string {
  const team = roster.find((r) => r.id === id)?.team;
  if (team) return TEAM_COLOURS[team];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PLAYER_COLOURS[h % PLAYER_COLOURS.length];
}
// where we draw ourselves, eased toward the server's position each frame
const drawn = { x: 0, y: 0 };
let lastFrame = performance.now();

// ---------- joining ----------

// A name and you're in as a guest; or sign in, or make an account, to keep a
// record on the board and take it to any device. Someone new, with no cookie
// yet, gets the how to play window once they're in the room.
let firstVisit = false;
async function start(): Promise<void> {
  const res = await fetch("/api/me");
  if (res.ok) return enter();
  firstVisit = true;
  $<HTMLDialogElement>("join").showModal();
}

$<HTMLFormElement>("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("name").value;
  const r = await fetch("/api/name", { method: "POST", body: JSON.stringify({ name }) });
  if (!r.ok) {
    $("join-error").textContent = (await r.json()).error;
    return;
  }
  $<HTMLDialogElement>("join").close();
  enter();
});

// The account dialog serves signing in, signing up from scratch, and a guest
// making an account mid-game (who keeps their player, so stays in the room).
let accountFromGame = false;
function openAccount(fromGame: boolean): void {
  accountFromGame = fromGame;
  $("account-error").textContent = "";
  $("account-back").hidden = fromGame;
  $<HTMLDialogElement>("join").close();
  $<HTMLDialogElement>("account").showModal();
}
$("to-account").addEventListener("click", () => openAccount(false));
$("make-account").addEventListener("click", () => {
  $<HTMLDialogElement>("window").close();
  openAccount(true);
});
$("account-back").addEventListener("click", () => {
  $<HTMLDialogElement>("account").close();
  $<HTMLDialogElement>("join").showModal();
});
async function account(path: "/api/login" | "/api/signup"): Promise<void> {
  const body = { username: $<HTMLInputElement>("username").value, password: $<HTMLInputElement>("password").value };
  const r = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) {
    $("account-error").textContent = (await r.json()).error;
    return;
  }
  $<HTMLDialogElement>("account").close();
  // signing in as someone else needs a fresh socket under the new player;
  // a guest upgrading is the same player, so only the record changes
  if (accountFromGame && path === "/api/signup") openWindow("scores");
  else if (socket) location.reload();
  else enter();
}
$<HTMLFormElement>("account-form").addEventListener("submit", (e) => {
  e.preventDefault();
  account("/api/login");
});
$("signup").addEventListener("click", () => {
  if ($<HTMLFormElement>("account-form").reportValidity()) account("/api/signup");
});

// A link with a room in it goes straight in; otherwise pick one, or make one.
async function enter(): Promise<void> {
  if (/^[A-Z]{4}$/.test(room)) return connect();
  const dialog = $<HTMLDialogElement>("rooms");
  const go = (code: string) => {
    room = code;
    history.replaceState(null, "", `/?room=${code}`);
    dialog.close();
    connect();
  };
  const { rooms } = (await (await fetch("/api/rooms")).json()) as {
    rooms: { code: string; phase: string; players: number; host: string | null; mode: Mode }[];
  };
  $("room-list").replaceChildren(
    ...rooms.map((r) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiet";
      b.textContent = r.code;
      b.addEventListener("click", () => go(r.code));
      const note = document.createElement("small");
      const busy = r.phase === "waiting" ? "in the lobby" : "mid-round";
      note.textContent = `${r.host ?? "nobody"}'s room, ${MODE_NAMES[r.mode]}, ${r.players} in, ${busy}`;
      li.append(b, note);
      return li;
    }),
  );
  $("new-room").addEventListener("click", async () => {
    go(((await (await fetch("/api/rooms", { method: "POST" })).json()) as { code: string }).code);
  });
  $<HTMLFormElement>("rooms-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $<HTMLInputElement>("code").value.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code)) go(code);
    else $("rooms-error").textContent = "A room code is four letters";
  });
  dialog.showModal();
}

let socket: WebSocket | null = null;
let retry = 500;

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}`);
  socket = ws;
  ws.onopen = () => {
    retry = 500;
    banner("");
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = (ev) => {
    if (ev.code === 4000) {
      $("lobby").hidden = true;
      banner("Playing in another tab");
      return;
    }
    banner("Reconnecting…");
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  };
  refreshRecord();
  canvas.focus();
  if (firstVisit) {
    firstVisit = false;
    openWindow("help");
  }
}

function handle(msg: { t: string } & Record<string, any>): void {
  switch (msg.t) {
    case "hello":
      myId = msg.id;
      $("hud-room").textContent = msg.room;
      document.title = `${msg.room} · Torchlight`;
      renderRoster();
      break;
    case "round": {
      const rows = msg.maze as string[];
      maze = { w: rows[0].length, h: rows.length, rows };
      winner = msg.winner;
      winnerTeam = msg.winnerTeam;
      if (msg.phase === "countdown") $("notices").replaceChildren();
      if (msg.phase === "ended") refreshRecord();
      resize();
      break;
    }
    case "roster":
      roster = msg.players;
      hostId = msg.host;
      mode = msg.mode;
      roomMap = msg.map;
      renderRoster();
      break;
    case "catch":
      notice(msg.catcher ? `${msg.catcher} caught ${msg.caught}` : `The dark took ${msg.caught}`);
      break;
    case "state": {
      const first = !state?.me;
      state = msg as unknown as State;
      if (first && state.me) Object.assign(drawn, { x: state.me.x, y: state.me.y });
      break;
    }
  }
}

// ---------- input ----------

// held keys, by physical key, with the direction each one was pressed as
const keys = new Map<string, [number, number]>();
let joystick: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
let aim: number | null = null;
// where the mouse last was over the maze; the torch points at it from wherever
// you are, so walking with the cursor still keeps the beam on that spot
let cursor: { x: number; y: number } | null = null;

// Letters match the character typed (e.key), so WASD means the keys labelled
// W, A, S and D on any layout; the physical QWERTY position (e.code) is the
// fallback for when a modifier or IME changes the character.
const KEYMAP: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  w: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  s: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  a: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  d: [1, 0],
  KeyD: [1, 0],
};

const keyDirection = (e: KeyboardEvent) => KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? KEYMAP[e.code];

// While a dialog is up, keys belong to it: the arrows and Space act there,
// and nobody walks into a wall.
const dialogOpen = () => document.querySelector("dialog[open]") !== null;

// Space uses whatever powerup you're carrying, as does tapping the slot
function use(): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "use" }));
  canvas.focus();
}
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || state?.phase !== "playing") return;
  if (document.activeElement instanceof HTMLInputElement || dialogOpen()) return;
  e.preventDefault(); // or Space would also press whichever button has focus
  use();
}, { capture: true });
$("slot").addEventListener("click", use);

addEventListener("keydown", (e) => {
  const dir = keyDirection(e);
  if (!dir || e.ctrlKey || e.metaKey || e.altKey || document.activeElement instanceof HTMLInputElement || dialogOpen()) return;
  e.preventDefault();
  keys.set(e.code, dir); // the torch stays on the cursor while you walk
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") {
    const r = canvas.getBoundingClientRect();
    cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  if (joystick && e.pointerId === joystick.id) {
    joystick.dx = e.clientX - joystick.x;
    joystick.dy = e.clientY - joystick.y;
  }
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  canvas.setPointerCapture(e.pointerId);
  joystick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
  cursor = null; // on a touch screen the torch points where you walk
});
const release = (e: PointerEvent) => {
  if (joystick?.id === e.pointerId) joystick = null;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

function direction(): [number, number] {
  if (joystick) {
    const len = Math.hypot(joystick.dx, joystick.dy);
    if (len < 8) return [0, 0];
    const k = Math.min(1, len / 50) / len;
    return [joystick.dx * k, joystick.dy * k];
  }
  let dx = 0;
  let dy = 0;
  for (const [kx, ky] of keys.values()) {
    dx += kx;
    dy += ky;
  }
  return [dx, dy];
}

let lastSent = "";
setInterval(() => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const [dx, dy] = direction();
  if (cursor && state?.me) {
    const [sx, sy] = toScreen(drawn.x, drawn.y);
    aim = Math.round(Math.atan2(cursor.y - sy, cursor.x - sx) * 1000) / 1000;
  } else aim = null;
  const msg = JSON.stringify({ t: "input", dx, dy, aim });
  if (msg !== lastSent) socket.send(msg);
  lastSent = msg;
}, 33);

// ---------- drawing ----------

let scale = 1;
let offX = 0;
let offY = 0;

function resize(): void {
  const r = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = fog.width = Math.round(r.width * dpr);
  canvas.height = fog.height = Math.round(r.height * dpr);
  scale = Math.min(canvas.width / maze.w, canvas.height / maze.h);
  offX = (canvas.width - maze.w * scale) / 2;
  offY = (canvas.height - maze.h * scale) / 2;
}
new ResizeObserver(resize).observe(canvas);

function toScreen(x: number, y: number): [number, number] {
  const dpr = devicePixelRatio || 1;
  return [(offX + x * scale) / dpr, (offY + y * scale) / dpr];
}

// The lit part of a beam, cut short wherever a wall stops it, unless it's an
// x-ray torch, which goes straight through. A torch dimmed by a blackout
// reaches half as far, the same reach the server judges it by.
function beam(c: CanvasRenderingContext2D, x: number, y: number, facing: number, xray = false, dimmed = false): void {
  const range = dimmed ? BEAM_RANGE * BLACKOUT_REACH : BEAM_RANGE;
  const steps = 48;
  c.beginPath();
  c.moveTo(offX + x * scale, offY + y * scale);
  for (let i = 0; i <= steps; i++) {
    const a = facing - BEAM_HALF_ANGLE + (2 * BEAM_HALF_ANGLE * i) / steps;
    const d = xray ? range : castRay(maze, x, y, a, range);
    c.lineTo(offX + (x + Math.cos(a) * d) * scale, offY + (y + Math.sin(a) * d) * scale);
  }
  c.closePath();
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  requestAnimationFrame(frame);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  const me = state.me;
  if (me) {
    const k = Math.min(1, dt * 18);
    drawn.x += (me.x - drawn.x) * k;
    drawn.y += (me.y - drawn.y) * k;
    if (Math.hypot(me.x - drawn.x, me.y - drawn.y) > 2) Object.assign(drawn, { x: me.x, y: me.y });
  }

  // the maze, tile by tile, so you can count the grid. Once the dark closes in,
  // tiles shake as the edge reaches them, then drop away into the dark.
  ctx.fillStyle = NIGHT.void;
  ctx.fillRect(offX, offY, maze.w * scale, maze.h * scale);
  const wall = (x: number, y: number) => maze.rows[y]?.[x] === "#";
  const zone = state.zone;
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      const depth = zone ? fallDepth(zone, zone.r, x, y) : -Infinity;
      tile(x, y, wall(x, y), !wall(x, y + 1) && y + 1 < maze.h, depth, now);
    }
  }

  const playing = me?.status === "alive";
  const myXray = !!me && me.xrayMs > 0;
  const myDim = !!me && me.dimmedMs > 0;

  // other torches you can see
  for (const o of state.others) {
    ctx.fillStyle = o.frozen ? `rgb(${ICE} / 0.24)` : o.xray ? "rgb(170 150 255 / 0.16)" : `rgb(${NIGHT.light} / 0.14)`;
    beam(ctx, o.x, o.y, o.facing, o.xray, o.dimmed);
    ctx.fill();
  }
  if (playing && me) {
    ctx.fillStyle = me.frozenMs > 0 ? `rgb(${ICE} / 0.36)` : myXray ? "rgb(170 150 255 / 0.3)" : `rgb(${NIGHT.light} / 0.3)`;
    beam(ctx, drawn.x, drawn.y, me.facing, myXray, myDim);
    ctx.fill();
  }

  // a flash lifts the dark off the whole maze, then lets it settle back
  const flash = Math.min(1, state.flashMs / FLASH_MS);

  // the dark: everything outside your torch and your little circle of sight
  if (playing && state.phase !== "ended") {
    fctx.globalCompositeOperation = "source-over";
    fctx.clearRect(0, 0, fog.width, fog.height);
    const dark = state.phase === "playing" ? 0.82 * (1 - flash) : 0.45;
    fctx.fillStyle = `rgb(6 8 14 / ${dark})`;
    fctx.fillRect(0, 0, fog.width, fog.height);
    fctx.globalCompositeOperation = "destination-out";
    fctx.fillStyle = "#000";
    beam(fctx, drawn.x, drawn.y, me.facing, myXray, myDim);
    fctx.fill();
    fctx.beginPath();
    fctx.arc(offX + drawn.x * scale, offY + drawn.y * scale, AURA_RADIUS * scale, 0, Math.PI * 2);
    fctx.fill();
    ctx.drawImage(fog, 0, 0);
    // the crumbling edge glows through the dark, so you can see where the floor is going
    if (zone) {
      for (let y = 0; y < maze.h; y++) {
        for (let x = 0; x < maze.w; x++) {
          const depth = fallDepth(zone, zone.r, x, y);
          if (depth <= -SHAKE_AHEAD || depth > 0) continue;
          ctx.fillStyle = `rgb(220 70 60 / ${0.35 * (1 + depth / SHAKE_AHEAD)})`;
          ctx.fillRect(offX + x * scale, offY + y * scale, scale + 0.5, scale + 0.5);
        }
      }
    }
  }
  // powerups glow through the dark: they're no secret, and worth heading for
  for (const it of state.pickups) pickup(it.x, it.y, it.kind, now);

  if (flash > 0) {
    ctx.fillStyle = `rgb(225 235 255 / ${0.3 * flash ** 3})`;
    ctx.fillRect(offX, offY, maze.w * scale, maze.h * scale);
  }

  // people
  const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? "";
  ctx.font = `600 ${Math.max(11, scale * 0.42)}px Inter, system-ui`;
  ctx.textAlign = "center";
  for (const o of state.others) {
    dot(o.x, o.y, o.facing, colourOf(o.id), nameOf(o.id));
    if (o.frozen) frost(o.x, o.y, now);
    if (state.phase === "playing") shield(o.x, o.y, o.cooldownMs, o.cooldownHeld, now);
  }
  // your own decoy, which only you are told about, drawn as a faint ghost of
  // you so you know where you left it; everyone else sees it as you
  if (playing && me?.decoy) ghost(me.decoy.x, me.decoy.y, me.decoy.facing, Math.min(1, me.decoy.ms / 1000));
  if (playing && me) {
    if (me.speedMs > 0) trail(drawn.x, drawn.y, me.facing);
    dot(drawn.x, drawn.y, me.facing, colourOf(myId), "you", me.lit);
    if (me.frozenMs > 0) frost(drawn.x, drawn.y, now);
    if (state.phase === "playing") shield(drawn.x, drawn.y, me.cooldownMs, me.cooldownHeld, now);
  }

  // a warning in the corner for the last ten seconds before the dark starts closing in
  const closes = state.zone?.closesInMs ?? 0;
  if (state.phase === "playing" && closes > 0 && closes <= 10_000) {
    const dpr = devicePixelRatio || 1;
    ctx.font = `500 ${13 * dpr}px Inter, system-ui`;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgb(240 120 110 / 0.9)";
    ctx.fillText(`Dark closes in ${Math.ceil(closes / 1000)}`, canvas.width - 12 * dpr, 22 * dpr);
  }

  // a red edge when someone's torch is on you
  if (me?.lit && state.phase === "playing") {
    ctx.strokeStyle = "rgb(240 110 90 / 0.85)";
    ctx.lineWidth = 8 * (devicePixelRatio || 1);
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  banner(bannerText(state));
  startButton(state);
  inventory(state);
}

// How far ahead of the edge a tile starts to shake, and how far behind it a
// falling tile is gone from sight, both in tiles.
const SHAKE_AHEAD = 0.6;
const FALL_DEPTH = 0.8;

// One tile of the maze. Floor tiles sit slightly inset so the grout between
// them shows the grid; a wall has a lit lip along its bottom when floor lies
// below it, so it reads as raised. A falling tile shrinks and darkens as it
// drops, and a fallen one is left as the dark underneath.
function tile(x: number, y: number, isWall: boolean, lip: boolean, depth: number, now: number): void {
  if (depth >= FALL_DEPTH) return;
  const fall = Math.max(0, depth / FALL_DEPTH);
  const size = 1 - fall * 0.85;
  let jx = 0;
  let jy = 0;
  if (depth > -SHAKE_AHEAD && depth <= 0) {
    const k = (1 + depth / SHAKE_AHEAD) * scale * 0.04;
    jx = Math.sin(now / 37 + x * 7 + y * 3) * k;
    jy = Math.cos(now / 41 + x * 5 + y * 11) * k;
  }
  const px = offX + (x + 0.5 - size / 2) * scale + jx;
  const py = offY + (y + 0.5 - size / 2) * scale + jy + fall * scale * 0.25;
  const s = size * scale;
  if (isWall) {
    ctx.fillStyle = NIGHT.wall;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
    if (lip) {
      ctx.fillStyle = NIGHT.edge;
      ctx.fillRect(px, py + s * 0.82, s + 0.5, s * 0.18 + 0.5);
    }
  } else {
    const gap = Math.max(1, scale * 0.04);
    ctx.fillStyle = NIGHT.grout;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
    ctx.fillStyle = NIGHT.floor;
    ctx.fillRect(px + gap, py + gap, s - gap, s - gap);
  }
  if (fall > 0) {
    ctx.fillStyle = `rgb(4 5 10 / ${fall})`;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
  } else if (depth > -SHAKE_AHEAD) {
    // about to go: a red tinge so you see it coming
    ctx.fillStyle = `rgb(200 50 50 / ${0.3 * (1 + depth / SHAKE_AHEAD)})`;
    ctx.fillRect(px, py, s + 0.5, s + 0.5);
  }
}

// The slot: what you're carrying, if anything. While a boost or an x-ray
// torch runs, or you're frozen, a bar in its colour drains along the bottom,
// and anything you picked up meanwhile waits its turn.
const NAMES: Record<Kind, string> = { speed: "Speed", xray: "X-ray", teleport: "Teleport", freeze: "Freeze", decoy: "Decoy", blackout: "Blackout" };
function inventory(s: State): void {
  const slot = $<HTMLButtonElement>("slot");
  const show = s.phase === "playing" && s.me?.status === "alive";
  if (slot.hidden === show) slot.hidden = !show;
  if (!show || !s.me) return;
  const { item, speedMs, xrayMs, frozenMs } = s.me;
  const running = speedMs > 0 ? "speed" : xrayMs > 0 ? "xray" : null;
  const label = item ? (running ? `${NAMES[item]}, after this` : NAMES[item]) : running ? NAMES[running] : "Empty";
  if (slot.dataset.kind !== (item ?? running ?? "")) slot.dataset.kind = item ?? running ?? "";
  if ($("slot-label").textContent !== label) $("slot-label").textContent = label;
  // a frozen player can't use what they carry until it wears off
  const usable = !!item && !running && frozenMs <= 0;
  if (slot.disabled === usable) slot.disabled = !usable;
  // while frozen, the bar shows the thaw instead
  const left = frozenMs > 0 ? frozenMs / FREEZE_MS : running === "speed" ? speedMs / SPEED_MS : running === "xray" ? xrayMs / XRAY_MS : 0;
  slot.style.setProperty("--left", String(left));
  slot.style.setProperty("--running", frozenMs > 0 ? KIND_COLOURS.freeze : running ? KIND_COLOURS[running] : "transparent");
}

function pickup(x: number, y: number, kind: Kind, now: number): void {
  const sx = offX + x * scale;
  const sy = offY + y * scale;
  const r = scale * 0.34 * (1 + 0.08 * Math.sin(now / 250 + x));
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
  glow.addColorStop(0, KIND_COLOURS[kind] + "88");
  glow.addColorStop(1, KIND_COLOURS[kind] + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(sx - r * 2.4, sy - r * 2.4, r * 4.8, r * 4.8);
  ctx.fillStyle = KIND_COLOURS[kind];
  ctx.beginPath();
  // a diamond: different from the round players at a glance
  ctx.moveTo(sx, sy - r);
  ctx.lineTo(sx + r, sy);
  ctx.lineTo(sx, sy + r);
  ctx.lineTo(sx - r, sy);
  ctx.closePath();
  ctx.fill();
}

// Your decoy as you see it: your dot, see-through, with a dashed ring, and
// fading out over its last second. Its label stays off while you stand on
// it, so the two names don't print over each other.
function ghost(x: number, y: number, facing: number, fade: number): void {
  ctx.save();
  ctx.globalAlpha = 0.45 * fade;
  dot(x, y, facing, colourOf(myId), Math.hypot(x - drawn.x, y - drawn.y) < 1 ? "" : "decoy");
  ctx.globalAlpha = 0.8 * fade;
  ctx.strokeStyle = KIND_COLOURS.decoy;
  ctx.lineWidth = Math.max(1.5, scale * 0.05);
  ctx.setLineDash([scale * 0.12, scale * 0.1]);
  ctx.beginPath();
  ctx.arc(offX + x * scale, offY + y * scale, PLAYER_RADIUS * scale * 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// a few fading ghosts behind you while a speed boost runs
function trail(x: number, y: number, facing: number): void {
  for (let i = 1; i <= 3; i++) {
    ctx.fillStyle = `rgb(63 191 133 / ${0.3 - i * 0.08})`;
    ctx.beginPath();
    ctx.arc(
      offX + (x - Math.cos(facing) * i * 0.22) * scale,
      offY + (y - Math.sin(facing) * i * 0.22) * scale,
      PLAYER_RADIUS * scale * (1 - i * 0.12),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

// In the lobby everyone sees which mode is picked; only the host can change
// it, and only the host gets the Start button, which needs someone to play against.
function startButton(s: State): void {
  const lobby = $("lobby");
  const show = s.phase === "waiting" && myId !== "" && socket?.readyState === WebSocket.OPEN;
  if (lobby.hidden === show) lobby.hidden = !show;
  const host = hostId === myId;
  const button = $<HTMLButtonElement>("start");
  if (button.hidden === host) button.hidden = !host;
  const ready = roster.filter((p) => !p.away).length >= 2;
  if (button.disabled === ready) button.disabled = !ready;
  const mapLabel = roomMap ? roomMap.name : "Fresh maze";
  const pick = $<HTMLButtonElement>("map-pick");
  if (pick.hidden === host) pick.hidden = !host;
  if ($("map-name").hidden !== host) $("map-name").hidden = host;
  if (pick.textContent !== mapLabel) pick.textContent = mapLabel;
  if ($("map-name").textContent !== mapLabel) $("map-name").textContent = mapLabel;
  for (const b of $("modes").querySelectorAll<HTMLButtonElement>("button")) {
    const on = String(b.dataset.mode === mode);
    if (b.getAttribute("aria-checked") !== on) b.setAttribute("aria-checked", on);
    if (b.disabled === host) b.disabled = !host;
  }
}

$("start").addEventListener("click", () => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "start" }));
  canvas.focus();
});
$("modes").addEventListener("click", (e) => {
  const picked = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.mode;
  if (picked && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "mode", mode: picked }));
  canvas.focus();
});

// The room's link, for sending to friends. Where the clipboard is refused,
// the link is offered to copy by hand instead.
// The host's map picker: a fresh maze, or any map in the shared library,
// newest first. The pick goes to the server, which tells the whole room.
const mapsDialog = $<HTMLDialogElement>("maps");
function pickMap(id: number | null): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "map", id }));
  mapsDialog.close();
}
$("map-pick").addEventListener("click", async () => {
  const { maps } = (await (await fetch("/api/maps")).json()) as {
    maps: { id: number; name: string; author: string; w: number; h: number }[];
  };
  const item = (label: string, note: string, id: number | null) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quiet";
    b.textContent = label;
    b.setAttribute("aria-pressed", String((roomMap?.id ?? null) === id));
    b.addEventListener("click", () => pickMap(id));
    const small = document.createElement("small");
    small.textContent = note;
    li.append(b, small);
    return li;
  };
  $("map-list").replaceChildren(
    item("Fresh maze", "a new maze each round, sized for the room", null),
    ...maps.map((m) => item(m.name, `by ${m.author}, ${m.w} by ${m.h}`, m.id)),
  );
  keys.clear();
  mapsDialog.showModal();
});
$("maps-close").addEventListener("click", () => mapsDialog.close());
mapsDialog.addEventListener("close", () => canvas.focus());

$("copy").addEventListener("click", async () => {
  const button = $("copy");
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy link"), 2000);
  } catch {
    prompt("Copy this link and send it to your friends", location.href);
  }
  canvas.focus();
});

// A player: their colour, a dark rim, a notch showing which way they face (so
// you can tell whose back is turned), and their name above. Red when lit.
function dot(x: number, y: number, facing: number, colour: string, label: string, lit = false): void {
  const sx = offX + x * scale;
  const sy = offY + y * scale;
  const r = PLAYER_RADIUS * scale;
  ctx.fillStyle = lit ? "#f06e5a" : colour;
  ctx.strokeStyle = "rgb(10 12 20 / 0.7)";
  ctx.lineWidth = Math.max(1.5, scale * 0.06);
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgb(10 12 20 / 0.75)";
  ctx.beginPath();
  ctx.arc(sx + Math.cos(facing) * r * 0.5, sy + Math.sin(facing) * r * 0.5, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgb(10 12 20 / 0.6)";
  ctx.fillText(label, sx + 1, sy - r - 5 + 1);
  ctx.fillStyle = "#eef0f5";
  ctx.fillText(label, sx, sy - r - 5);
}

// Frozen: the dot sealed in a block of ice, a hexagon with a bright rim and a
// glint, so it reads apart from the stun ring, which is a plain circle.
function frost(x: number, y: number, now: number): void {
  const sx = offX + x * scale;
  const sy = offY + y * scale;
  const r = PLAYER_RADIUS * scale * 1.35;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = `rgb(${ICE} / 0.5)`;
  ctx.fill();
  ctx.strokeStyle = `rgb(${ICE} / ${0.85 + 0.15 * Math.sin(now / 300)})`;
  ctx.lineWidth = Math.max(2, scale * 0.07);
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineJoin = "miter";
  // a glint across the top left face
  ctx.strokeStyle = "rgb(255 255 255 / 0.85)";
  ctx.lineWidth = Math.max(1.5, scale * 0.05);
  ctx.beginPath();
  ctx.moveTo(sx - r * 0.55, sy - r * 0.15);
  ctx.lineTo(sx - r * 0.15, sy - r * 0.55);
  ctx.stroke();
}

// A ring while a head-on bump or stand-off shields a pair from catching each other: steady
// while a torch holds the stun, then flashing once the countdown runs, faster
// in its last second so the end is no surprise.
function shield(x: number, y: number, cooldownMs: number, held: boolean, now: number): void {
  if (cooldownMs <= 0) return;
  const rate = cooldownMs < 1000 ? 10 : 4; // blinks per second
  const on = held ? 1 : 0.5 + 0.5 * Math.sin((now / 1000) * rate * Math.PI * 2);
  ctx.strokeStyle = `rgb(140 205 255 / ${0.25 + 0.75 * on})`;
  ctx.lineWidth = Math.max(2, scale * 0.08);
  ctx.beginPath();
  ctx.arc(offX + x * scale, offY + y * scale, PLAYER_RADIUS * scale * 1.7, 0, Math.PI * 2);
  ctx.stroke();
}

function bannerText(s: State): string {
  if (socket?.readyState !== WebSocket.OPEN) return currentBanner;
  const secs = Math.ceil(s.remainingMs / 1000);
  switch (s.phase) {
    case "waiting": {
      const others = roster.filter((p) => p.id !== myId && !p.away).length;
      if (hostId === myId) return others === 0 ? "Send a friend the link to play" : "Pick a mode, and start when everyone's in";
      const host = roster.find((p) => p.id === hostId)?.name ?? "the host";
      return `Waiting for ${host} to start ${MODE_NAMES[mode].toLowerCase()}`;
    }
    case "countdown": {
      const team = roster.find((p) => p.id === myId)?.team;
      if (team) return `You're on ${TEAM_NAMES[team]}. Lights out in ${secs}`;
      return `Lights out in ${secs}`;
    }
    case "ended":
      if (winnerTeam) return `${TEAM_NAMES[winnerTeam]} wins the round`;
      return winner ? `${winner} is the last torch standing` : "Nobody left standing";
    case "playing":
      if (s.me?.status === "caught") return "Caught! Watching until the next round";
      if (s.me?.status === "spectating" && mode === "duel") return "Watching the duel; you're up when it's your turn";
      if (s.me?.status === "spectating") return "Round in progress; you're in the next one";
      if (s.me?.lit) return "You're in someone's light. Move!";
      if (s.me?.frozenMs) return `Frozen! ${Math.ceil(s.me.frozenMs / 1000)}s`;
      if (s.me?.dimmedMs) return `Blackout! Your torch is dimmed for ${Math.ceil(s.me.dimmedMs / 1000)}s`;
      if (s.me?.cooldownHeld) return "Stunned! No catches until the light comes off";
      if (s.me?.cooldownMs) return `Stunned! No catches between you for ${Math.ceil(s.me.cooldownMs / 1000)}s`;
      if (s.me?.xrayMs) return "X-ray torch: you see through walls, but can only catch in the open";
      if (s.me?.speedMs) return "Speed boost!";
      return "";
  }
}

let currentBanner = "";
function banner(text: string): void {
  if (text === currentBanner) return;
  currentBanner = text;
  $("banner").textContent = text;
}

// ---------- the corner and the notices ----------

// The corner shows how many opponents are still out there in the dark for you
// to find. Your own status is in the banner.
function renderRoster(): void {
  const myTeam = roster.find((p) => p.id === myId)?.team;
  const opponents = roster.filter((p) => p.id !== myId && p.status !== "spectating" && (!myTeam || p.team !== myTeam));
  const hiding = opponents.filter((p) => p.status === "alive").length;
  $("hud-count").textContent =
    opponents.length === 0
      ? "No opponents yet"
      : `${hiding} of ${opponents.length} ${opponents.length === 1 ? "opponent" : "opponents"} left`;
}

// Each catch shows under the banner for a few seconds, newest on top, and
// only the last few stay so the stack never covers the maze.
const NOTICE_MS = 4000;
function notice(text: string): void {
  const list = $("notices");
  const li = document.createElement("li");
  li.textContent = text;
  list.prepend(li);
  while (list.children.length > 3) list.lastElementChild!.remove();
  setTimeout(() => li.classList.add("gone"), NOTICE_MS);
  setTimeout(() => li.remove(), NOTICE_MS + 600);
}

// ---------- the floating window ----------

// One window over the maze with a tab for each page. It closes with its
// button, Escape, or a click outside it, and gives focus back to the maze.
// The round carries on behind it, but keys stay with the window while it's up.
const win = $<HTMLDialogElement>("window");
const tabs = [...win.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

function showTab(name: string, focus = false): void {
  if (name === "scores") refreshRecord();
  for (const tab of tabs) {
    const on = tab.id === `tab-${name}`;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute("aria-controls")!).hidden = !on;
    if (on && focus) tab.focus();
  }
}

function openWindow(name: string): void {
  showTab(name);
  if (!win.open) {
    keys.clear(); // or a key held as it opened would keep you walking
    joystick = null;
    win.showModal();
  }
  $(`tab-${name}`).focus();
}

win.addEventListener("close", () => canvas.focus());
$("window-close").addEventListener("click", () => win.close());
// a click on the backdrop lands on the dialog itself, outside its box
win.addEventListener("click", (e) => {
  const r = win.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (e.target === win && !inside) win.close();
});
$("open-help").addEventListener("click", () => openWindow("help"));
$("open-scores").addEventListener("click", () => openWindow("scores"));

// the tabs are picked by clicking, or with the arrow keys once one has focus
for (const tab of tabs) tab.addEventListener("click", () => showTab(tab.id.slice(4)));
win.querySelector('[role="tablist"]')!.addEventListener("keydown", (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[(e as KeyboardEvent).key];
  if (!step) return;
  e.preventDefault();
  const at = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  showTab(tabs[(at + step + tabs.length) % tabs.length].id.slice(4), true);
});

// ---------- the scores tab ----------

// Your record as a few numbers, and who you're signed in as. A guest's
// record is kept too, but only in this browser and never on the board.
async function refreshRecord(): Promise<void> {
  const [me, board] = await Promise.all([fetch("/api/me"), fetch("/api/board")]);
  if (me.ok) {
    const r = await me.json();
    const who = $("who");
    who.textContent = r.guest ? `${r.name} (guest)` : r.name;
    if (!r.guest) {
      const out = document.createElement("button");
      out.type = "button";
      out.className = "quiet";
      out.textContent = "Sign out";
      out.addEventListener("click", async () => {
        await fetch("/api/logout", { method: "POST" });
        location.reload();
      });
      who.append(out);
    }
    $("guest-note").hidden = !r.guest;
    const stats: [string, number][] = [
      ["played", r.rounds],
      ["won", r.wins],
      ["caught others", r.catches],
      ["got caught", r.caught],
      ["fell", r.falls],
      ["win rate", r.rounds ? Math.round((100 * r.wins) / r.rounds) : 0],
    ];
    $("record").replaceChildren(
      ...stats.map(([label, n]) => {
        const div = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = label === "win rate" ? `${n}%` : String(n);
        div.append(dt, dd);
        return div;
      }),
    );
  }
  if (board.ok) {
    const { leaders } = (await board.json()) as { leaders: { name: string; catches: number; wins: number }[] };
    $("board").replaceChildren(
      ...leaders.map((l) => {
        const li = document.createElement("li");
        li.textContent = `${l.name}: ${l.wins} wins, ${l.catches} catches`;
        return li;
      }),
    );
  }
}

requestAnimationFrame(frame);
start();
