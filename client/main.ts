import {
  AURA_RADIUS,
  BEAM_HALF_ANGLE,
  BEAM_RANGE,
  FLASH_MS,
  PLAYER_RADIUS,
  castRay,
  type Maze,
} from "../shared/world.ts";

type Phase = "waiting" | "countdown" | "playing" | "ended";
type Status = "alive" | "caught" | "spectating";
interface Seen {
  id: string;
  x: number;
  y: number;
  facing: number;
  cooldownMs: number;
  cooldownHeld: boolean;
}
interface State {
  phase: Phase;
  remainingMs: number;
  flashMs: number;
  me?: { x: number; y: number; facing: number; status: Status; lit: boolean; cooldownMs: number; cooldownHeld: boolean };
  others: Seen[];
}
interface RosterEntry {
  id: string;
  name: string;
  status: Status;
  away: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("maze");
const ctx = canvas.getContext("2d")!;
const fog = document.createElement("canvas");
const fctx = fog.getContext("2d")!;

let myId = "";
let maze: Maze = { w: 1, h: 1, rows: ["#"] };
let state: State | null = null;
let roster: RosterEntry[] = [];
let winner: string | null = null;
// where we draw ourselves, eased toward the server's position each frame
const drawn = { x: 0, y: 0 };
let lastFrame = performance.now();

// ---------- joining ----------

async function start(): Promise<void> {
  const res = await fetch("/api/me");
  if (res.ok) return connect();
  const dialog = $<HTMLDialogElement>("join");
  dialog.showModal();
  $<HTMLFormElement>("join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>("name").value;
    const r = await fetch("/api/name", { method: "POST", body: JSON.stringify({ name }) });
    if (!r.ok) {
      $("join-error").textContent = (await r.json()).error;
      return;
    }
    dialog.close();
    connect();
  });
}

let socket: WebSocket | null = null;
let retry = 500;

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 500;
    banner("");
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = (ev) => {
    if (ev.code === 4000) {
      banner("Playing in another tab");
      return;
    }
    banner("Reconnecting…");
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  };
  refreshRecord();
  canvas.focus();
}

function handle(msg: { t: string } & Record<string, any>): void {
  switch (msg.t) {
    case "hello":
      myId = msg.id;
      renderRoster();
      break;
    case "round": {
      const rows = msg.maze as string[];
      maze = { w: rows[0].length, h: rows.length, rows };
      winner = msg.winner;
      if (msg.phase === "countdown") $("feed").replaceChildren();
      if (msg.phase === "ended") refreshRecord();
      resize();
      break;
    }
    case "roster":
      roster = msg.players;
      renderRoster();
      break;
    case "catch":
      addFeed(`${msg.catcher} caught ${msg.caught}`);
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

addEventListener("keydown", (e) => {
  const dir = keyDirection(e);
  if (!dir || e.ctrlKey || e.metaKey || e.altKey || document.activeElement instanceof HTMLInputElement) return;
  e.preventDefault();
  keys.set(e.code, dir);
  aim = null; // walking with keys points the torch where you walk
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" && state?.me) {
    const [sx, sy] = toScreen(drawn.x, drawn.y);
    const r = canvas.getBoundingClientRect();
    aim = Math.atan2(e.clientY - r.top - sy, e.clientX - r.left - sx);
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
  aim = null;
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

// The lit part of a beam, cut short wherever a wall stops it.
function beam(c: CanvasRenderingContext2D, x: number, y: number, facing: number): void {
  const steps = 48;
  c.beginPath();
  c.moveTo(offX + x * scale, offY + y * scale);
  for (let i = 0; i <= steps; i++) {
    const a = facing - BEAM_HALF_ANGLE + (2 * BEAM_HALF_ANGLE * i) / steps;
    const d = castRay(maze, x, y, a, BEAM_RANGE);
    c.lineTo(offX + (x + Math.cos(a) * d) * scale, offY + (y + Math.sin(a) * d) * scale);
  }
  c.closePath();
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  requestAnimationFrame(frame);
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  const me = state.me;
  if (me) {
    const k = Math.min(1, dt * 18);
    drawn.x += (me.x - drawn.x) * k;
    drawn.y += (me.y - drawn.y) * k;
    if (Math.hypot(me.x - drawn.x, me.y - drawn.y) > 2) Object.assign(drawn, { x: me.x, y: me.y });
  }

  // floor and walls
  ctx.fillStyle = "#4a5266";
  ctx.fillRect(offX, offY, maze.w * scale, maze.h * scale);
  ctx.fillStyle = "#12151d";
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      if (maze.rows[y][x] === "#") ctx.fillRect(offX + x * scale, offY + y * scale, scale + 0.5, scale + 0.5);
    }
  }

  const playing = me?.status === "alive";

  // other torches you can see
  ctx.fillStyle = "rgb(255 215 122 / 0.18)";
  for (const o of state.others) {
    beam(ctx, o.x, o.y, o.facing);
    ctx.fill();
  }
  if (playing && me) {
    ctx.fillStyle = "rgb(255 215 122 / 0.28)";
    beam(ctx, drawn.x, drawn.y, me.facing);
    ctx.fill();
  }

  // a flash lifts the dark off the whole maze, then lets it settle back
  const flash = Math.min(1, state.flashMs / FLASH_MS);

  // the dark: everything outside your torch and your little circle of sight
  if (playing && state.phase !== "ended") {
    fctx.globalCompositeOperation = "source-over";
    fctx.clearRect(0, 0, fog.width, fog.height);
    const dark = state.phase === "playing" ? 0.8 * (1 - flash) : 0.5;
    fctx.fillStyle = `rgb(0 0 0 / ${dark})`;
    fctx.fillRect(0, 0, fog.width, fog.height);
    fctx.globalCompositeOperation = "destination-out";
    fctx.fillStyle = "#000";
    beam(fctx, drawn.x, drawn.y, me.facing);
    fctx.fill();
    fctx.beginPath();
    fctx.arc(offX + drawn.x * scale, offY + drawn.y * scale, AURA_RADIUS * scale, 0, Math.PI * 2);
    fctx.fill();
    ctx.drawImage(fog, 0, 0);
  }
  if (flash > 0) {
    ctx.fillStyle = `rgb(220 230 255 / ${0.35 * flash ** 3})`;
    ctx.fillRect(offX, offY, maze.w * scale, maze.h * scale);
  }

  // people
  const nameOf = (id: string) => roster.find((r) => r.id === id)?.name ?? "";
  ctx.font = `${Math.max(11, scale * 0.45)}px system-ui`;
  ctx.textAlign = "center";
  for (const o of state.others) {
    dot(o.x, o.y, "#e8e6df", nameOf(o.id));
    if (state.phase === "playing") shield(o.x, o.y, o.cooldownMs, o.cooldownHeld, now);
  }
  if (playing && me) {
    dot(drawn.x, drawn.y, me.lit ? "#ff6b5b" : "#ffd77a", "you");
    if (state.phase === "playing") shield(drawn.x, drawn.y, me.cooldownMs, me.cooldownHeld, now);
  }

  // a red edge when someone's torch is on you
  if (me?.lit && state.phase === "playing") {
    ctx.strokeStyle = "rgb(255 107 91 / 0.8)";
    ctx.lineWidth = 8 * (devicePixelRatio || 1);
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  banner(bannerText(state));
}

function dot(x: number, y: number, colour: string, label: string): void {
  const sx = offX + x * scale;
  const sy = offY + y * scale;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(sx, sy, PLAYER_RADIUS * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8e6df";
  ctx.fillText(label, sx, sy - PLAYER_RADIUS * scale - 4);
}

// A ring while a head-on bump shields a pair from catching each other: steady
// while a torch holds the stun, then flashing once the countdown runs, faster
// in its last second so the end is no surprise.
function shield(x: number, y: number, cooldownMs: number, held: boolean, now: number): void {
  if (cooldownMs <= 0) return;
  const rate = cooldownMs < 1000 ? 10 : 4; // blinks per second
  const on = held ? 1 : 0.5 + 0.5 * Math.sin((now / 1000) * rate * Math.PI * 2);
  ctx.strokeStyle = `rgb(120 200 255 / ${0.25 + 0.75 * on})`;
  ctx.lineWidth = Math.max(2, scale * 0.08);
  ctx.beginPath();
  ctx.arc(offX + x * scale, offY + y * scale, PLAYER_RADIUS * scale * 1.7, 0, Math.PI * 2);
  ctx.stroke();
}

function bannerText(s: State): string {
  if (socket?.readyState !== WebSocket.OPEN) return currentBanner;
  const secs = Math.ceil(s.remainingMs / 1000);
  switch (s.phase) {
    case "waiting":
      return "Waiting for one more seeker…";
    case "countdown":
      return `Lights out in ${secs}`;
    case "ended":
      return winner ? `${winner} is the last torch standing` : "Nobody left standing";
    case "playing":
      if (s.me?.status === "caught") return "Caught! Watching until the next round";
      if (s.me?.status === "spectating") return "Round in progress; you're in the next one";
      if (s.me?.lit) return "You're in someone's light. Move!";
      if (s.me?.cooldownHeld) return "Bumped! Stunned until the light comes off";
      if (s.me?.cooldownMs) return `Bumped! No catches between you for ${Math.ceil(s.me.cooldownMs / 1000)}s`;
      return "";
  }
}

let currentBanner = "";
function banner(text: string): void {
  if (text === currentBanner) return;
  currentBanner = text;
  $("banner").textContent = text;
}

// ---------- side panel ----------

// The tracker lists your opponents only: who is still out there in the dark
// for you to find. Your own status is in the banner over the maze.
function renderRoster(): void {
  const opponents = roster.filter((p) => p.id !== myId && p.status !== "spectating");
  const hiding = opponents.filter((p) => p.status === "alive").length;
  $("count").textContent =
    opponents.length === 0
      ? "No opponents yet"
      : `${hiding} of ${opponents.length} ${opponents.length === 1 ? "opponent" : "opponents"} left`;
  const order = { alive: 0, caught: 1, spectating: 2 };
  $("roster").replaceChildren(
    ...roster
      .filter((p) => p.id !== myId)
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
      .map((p) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = p.name;
        name.className = p.status;
        const note = document.createElement("small");
        note.textContent = p.away ? "away" : p.status === "spectating" ? "next round" : p.status === "caught" ? "caught" : "";
        li.append(name, note);
        return li;
      }),
  );
}

function addFeed(text: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  $("feed").prepend(li);
}

async function refreshRecord(): Promise<void> {
  const [me, board] = await Promise.all([fetch("/api/me"), fetch("/api/board")]);
  if (me.ok) {
    const r = await me.json();
    $("record").textContent =
      `${r.name}: ${r.catches} catches, ${r.wins} wins, caught ${r.caught} times in ${r.rounds} rounds.`;
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
