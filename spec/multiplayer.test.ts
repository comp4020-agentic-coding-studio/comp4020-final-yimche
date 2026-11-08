import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// Multi-user, real-time and persistent, checked against the running app.
const baseUrl = inject("baseUrl");

async function signUp(name: string): Promise<string> {
  const res = await fetch(new URL("/api/name", baseUrl), { method: "POST", body: JSON.stringify({ name }) });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function newRoom(): Promise<string> {
  const res = await fetch(new URL("/api/rooms", baseUrl), { method: "POST" });
  expect(res.status).toBe(200);
  return (await res.json()).code;
}

function open(cookie: string, room = "TEST"): Promise<{ ws: WebSocket; messages: any[] }> {
  const url = new URL(`/ws?room=${room}`, baseUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const ws = new WebSocket(url, { headers: { cookie } });
  const messages: any[] = [];
  ws.on("message", (d) => messages.push(JSON.parse(String(d))));
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("error", reject);
  });
}

async function within<T>(ms: number, find: () => T | undefined): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (Date.now() > until) throw new Error(`not seen within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

it("a name is kept: come back with the same cookie and you're still you", async () => {
  const cookie = await signUp(`keeper${Date.now() % 1000}`);
  const me = await fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ catches: 0, wins: 0 });
});

it("rejects a blank name", async () => {
  const res = await fetch(new URL("/api/name", baseUrl), { method: "POST", body: JSON.stringify({ name: "   " }) });
  expect(res.status).toBe(400);
});

it("won't open a game socket for someone without a name", async () => {
  await expect(open("sid=nobody")).rejects.toThrow();
});

it("a second player shows up on the first player's tracker within a second", async () => {
  const room = await newRoom();
  const one = await open(await signUp("first"), room);
  const cookie = await signUp("second");
  const two = await open(cookie, room);
  const secondId = await within(1000, () => two.messages.find((m) => m.t === "hello")?.id);
  const started = Date.now();
  await within(1000, () =>
    one.messages.find((m) => m.t === "roster" && m.players.some((p: any) => p.id === secondId)),
  );
  expect(Date.now() - started).toBeLessThan(1000);
  one.ws.close();
  two.ws.close();
});

it("rooms are separate: someone in another room doesn't show up on your tracker", async () => {
  const [mine, theirs] = [await newRoom(), await newRoom()];
  const one = await open(await signUp("here"), mine);
  const two = await open(await signUp("there"), theirs);
  const twoId = await within(1000, () => two.messages.find((m) => m.t === "hello")?.id);
  await new Promise((r) => setTimeout(r, 300));
  const rosters = one.messages.filter((m) => m.t === "roster");
  expect(rosters.length).toBeGreaterThan(0);
  expect(rosters.some((m) => m.players.some((p: any) => p.id === twoId))).toBe(false);
  one.ws.close();
  two.ws.close();
});

it("the first one into a new room is its host, and the room is listed", async () => {
  const room = await newRoom();
  const one = await open(await signUp("hostie"), room);
  const oneId = await within(1000, () => one.messages.find((m) => m.t === "hello")?.id);
  await within(1000, () => one.messages.find((m) => m.t === "roster" && m.host === oneId));
  const { rooms } = await (await fetch(new URL("/api/rooms", baseUrl))).json();
  expect(rooms).toContainEqual(expect.objectContaining({ code: room, host: "hostie" }));
  one.ws.close();
});

it("every decision record the README links to is published as a page", async () => {
  const readme = (await import("node:fs")).readFileSync("README.md", "utf8");
  const links = [...readme.matchAll(/\]\((docs\/decisions\/[^)]+\.md)\)/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const res = await fetch(new URL(`/readme/${link}`, baseUrl));
    expect(res.status, link).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<h2>Decision</h2>");
  }
});

async function post(path: string, body: unknown, cookie = "") {
  return fetch(new URL(path, baseUrl), { method: "POST", body: JSON.stringify(body), headers: { cookie } });
}
const sid = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
const unique = () => `u${Date.now() % 1e8}${Math.floor(Math.random() * 100)}`;

it("an account is a username and password, and signing in again on another device gets the same player", async () => {
  const username = unique();
  const made = await post("/api/signup", { username, password: "lanterns" });
  expect(made.status).toBe(200);
  const { id } = await made.json();
  const again = await post("/api/login", { username: username.toUpperCase(), password: "lanterns" });
  expect(again.status).toBe(200);
  const me = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie: sid(again) } })).json();
  expect(me).toMatchObject({ id, name: username, guest: false, rounds: 0 });
});

it("a wrong password doesn't sign you in", async () => {
  const username = unique();
  await post("/api/signup", { username, password: "lanterns" });
  expect((await post("/api/login", { username, password: "candles" })).status).toBe(401);
});

it("a username can only be taken once, whatever the case", async () => {
  const username = unique();
  expect((await post("/api/signup", { username, password: "lanterns" })).status).toBe(200);
  expect((await post("/api/signup", { username: username.toUpperCase(), password: "lanterns" })).status).toBe(409);
});

it("a guest who makes an account keeps their player and record", async () => {
  const cookie = await signUp("drifter");
  const { id } = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie } })).json();
  const username = unique();
  expect((await post("/api/signup", { username, password: "lanterns" }, cookie)).status).toBe(200);
  const me = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie } })).json();
  expect(me).toMatchObject({ id, name: username, guest: false });
});

it("the cookie is a session, not the player id everyone in the room is sent", async () => {
  const cookie = await signUp("secretive");
  const { id } = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie } })).json();
  expect(cookie).not.toContain(id);
  await expect(open(`sid=${id}`)).rejects.toThrow();
});

it("signing out forgets the session", async () => {
  const username = unique();
  const cookie = sid(await post("/api/signup", { username, password: "lanterns" }));
  await post("/api/logout", {}, cookie);
  expect((await fetch(new URL("/api/me", baseUrl), { headers: { cookie } })).status).toBe(404);
});

it("guests never show up on the board", async () => {
  const cookie = await signUp("ghostly");
  const { id } = await (await fetch(new URL("/api/me", baseUrl), { headers: { cookie } })).json();
  const { leaders } = await (await fetch(new URL("/api/board", baseUrl))).json();
  expect(JSON.stringify(leaders)).not.toContain(id);
  expect(leaders.every((l: any) => l.name !== "ghostly")).toBe(true);
});

// The shared library of hand-made maps: anyone with a name can save one, and
// everyone sees every map saved.
const openMap = (w = 13, h = 11) =>
  Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? "#".repeat(w) : "#" + ".".repeat(w - 2) + "#"));

it("a saved map goes in the shared library, with who made it, for everyone to see", async () => {
  const cookie = await signUp("mapmaker");
  const name = `Hall ${unique()}`;
  const saved = await post("/api/maps", { name, rows: openMap() }, cookie);
  expect(saved.status).toBe(200);
  const { id } = await saved.json();
  const { maps } = await (await fetch(new URL("/api/maps", baseUrl))).json();
  expect(maps).toContainEqual(expect.objectContaining({ id, name, author: "mapmaker", w: 13, h: 11 }));
  const one = await (await fetch(new URL(`/api/maps/${id}`, baseUrl))).json();
  expect(one).toMatchObject({ id, name, author: "mapmaker", rows: openMap() });
});

it("a map that can't be played is turned away, and says why", async () => {
  const cookie = await signUp("sloppy");
  const leaky = openMap().map((r, y) => (y === 5 ? "." + r.slice(1) : r));
  const res = await post("/api/maps", { name: "Leaky", rows: leaky }, cookie);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/outside edge/);
  expect((await post("/api/maps", { name: "  ", rows: openMap() }, cookie)).status).toBe(400);
});

it("saving a map takes a name first, like playing does", async () => {
  expect((await post("/api/maps", { name: "Nobody's", rows: openMap() })).status).toBe(401);
});

it("a map nobody saved isn't there", async () => {
  expect((await fetch(new URL("/api/maps/999999", baseUrl))).status).toBe(404);
});

it("the host picks a saved map in the lobby, everyone in the room hears which, and the round is played on it", async () => {
  const hostCookie = await signUp("cartographer");
  const name = `Wide ${unique()}`;
  const { id } = await (await post("/api/maps", { name, rows: openMap(21, 11) }, hostCookie)).json();
  const room = await newRoom();
  const host = await open(hostCookie, room);
  const guest = await open(await signUp("tourist"), room);
  await within(1000, () => guest.messages.find((m) => m.t === "roster" && m.players.length === 2));
  host.ws.send(JSON.stringify({ t: "map", id }));
  await within(1000, () => guest.messages.find((m) => m.t === "roster" && m.map?.id === id && m.map.name === name));
  host.ws.send(JSON.stringify({ t: "start" }));
  const round = await within(1000, () => guest.messages.find((m) => m.t === "round" && m.phase === "countdown"));
  expect(round.maze).toEqual(openMap(21, 11));
  host.ws.close();
  guest.ws.close();
});

it("a map is saved with its theme, and a round on it says so", async () => {
  const hostCookie = await signUp("decorator");
  const name = `Crypt ${unique()}`;
  const saved = await post("/api/maps", { name, rows: openMap(), theme: "catacombs" }, hostCookie);
  expect(saved.status).toBe(200);
  const { id } = await saved.json();
  const { maps } = await (await fetch(new URL("/api/maps", baseUrl))).json();
  expect(maps).toContainEqual(expect.objectContaining({ id, theme: "catacombs" }));
  expect(await (await fetch(new URL(`/api/maps/${id}`, baseUrl))).json()).toMatchObject({ id, theme: "catacombs" });

  // no theme given is night; a theme that isn't one of the five is turned away, and says why
  const plain = await (await post("/api/maps", { name: `Plain ${unique()}`, rows: openMap() }, hostCookie)).json();
  expect(await (await fetch(new URL(`/api/maps/${plain.id}`, baseUrl))).json()).toMatchObject({ theme: "night" });
  const bad = await post("/api/maps", { name: "Swamp", rows: openMap(), theme: "swamp" }, hostCookie);
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toBe("A map's theme is one of night, catacombs, garden, manor or foundry");

  // everyone in the room is told the theme with the round
  const room = await newRoom();
  const host = await open(hostCookie, room);
  const guest = await open(await signUp("visitor"), room);
  await within(1000, () => guest.messages.find((m) => m.t === "roster" && m.players.length === 2));
  host.ws.send(JSON.stringify({ t: "map", id }));
  await within(1000, () => guest.messages.find((m) => m.t === "roster" && m.map?.id === id));
  host.ws.send(JSON.stringify({ t: "start" }));
  for (const p of [host, guest]) {
    const round = await within(1000, () => p.messages.find((m) => m.t === "round" && m.phase === "countdown"));
    expect(round.theme).toBe("catacombs");
  }
  host.ws.close();
  guest.ws.close();
});

type Client = { ws: WebSocket; messages: any[] };
const me = (p: Client) => p.messages.findLast((m) => m.t === "state")?.me;

// Walks a player over the wire to the nearest powerup of a kind, on an open
// map where a straight line always gets there, and stops once it's carried.
// Both torches point away from each other the whole time, so nobody is caught
// on the way and nobody is in the other's beam at the end.
async function fetchPowerup(p: Client, other: Client, kind: string): Promise<void> {
  const away = (from: any, to: any) => Math.atan2(from.y - to.y, from.x - to.x);
  await within(8000, () => {
    const s = p.messages.findLast((m) => m.t === "state");
    const o = me(other);
    if (!s?.me || !o) return undefined;
    other.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, aim: away(o, s.me) }));
    if (s.me.item === kind) {
      p.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, aim: away(s.me, o) }));
      return true;
    }
    const it = s.pickups.filter((i: any) => i.kind === kind)
      .sort((x: any, y: any) => Math.hypot(x.x - s.me.x, x.y - s.me.y) - Math.hypot(y.x - s.me.x, y.y - s.me.y))[0];
    if (it) p.ws.send(JSON.stringify({ t: "input", dx: it.x - s.me.x, dy: it.y - s.me.y, aim: away(s.me, o) }));
    return undefined;
  });
}

it("a freeze over the wire: the user is shown the rival it stopped, and that rival's own powerup is refused and kept", async () => {
  const hostCookie = await signUp("icy");
  const { id } = await (await post("/api/maps", { name: `Open ${unique()}`, rows: openMap() }, hostCookie)).json();
  const room = await newRoom();
  const host = await open(hostCookie, room);
  const other = await open(await signUp("bystander"), room);
  await within(1000, () => host.messages.find((m) => m.t === "roster" && m.players.length === 2));
  host.ws.send(JSON.stringify({ t: "map", id }));
  await within(1000, () => host.messages.find((m) => m.t === "roster" && m.map?.id === id));
  host.ws.send(JSON.stringify({ t: "start" }));
  await within(5000, () => host.messages.find((m) => m.t === "state" && m.phase === "playing"));
  await fetchPowerup(other, host, "speed");
  await fetchPowerup(host, other, "freeze");
  const before = host.messages.length;
  host.ws.send(JSON.stringify({ t: "use" }));
  const used = await within(1000, () => host.messages.slice(before).find((m) => m.t === "used"));
  expect(used).toEqual({ t: "used", kind: "freeze", ok: true, frozen: false });
  // the one rival is frozen, and the user's view has them, marked revealed
  const after = host.messages.indexOf(used);
  const shown = await within(1000, () => host.messages.slice(after).find((m) => m.t === "state"));
  expect(shown.others).toContainEqual(expect.objectContaining({ frozen: true, revealed: true }));
  const frozen = await within(1000, () => other.messages.findLast((m) => m.t === "state" && m.me.frozenMs > 0));
  expect(frozen.others.some((o: any) => "revealed" in o)).toBe(false);
  // the frozen rival presses Space: refused, said why, and kept. A powerup can
  // turn up underfoot on a small map and swap in, so it's whatever they hold
  const held = other.messages.findLast((m) => m.t === "state").me.item;
  expect(held).not.toBeNull();
  const mark = other.messages.length;
  other.ws.send(JSON.stringify({ t: "use" }));
  const refused = await within(1000, () => other.messages.slice(mark).find((m) => m.t === "used"));
  expect(refused).toEqual({ t: "used", kind: held, ok: false, frozen: true });
  const at = other.messages.indexOf(refused);
  const next = await within(1000, () => other.messages.slice(at).find((m) => m.t === "state"));
  expect(next.me.item).toBe(held);
  // each answer goes to the one who pressed, nobody else
  expect(host.messages.filter((m) => m.t === "used")).toHaveLength(1);
  host.ws.close();
  other.ws.close();
}, 30_000); // a real countdown, then two real walks to a pickup

it("everyone hears who caught whom, but only the one caught is told from which side", async () => {
  const hostCookie = await signUp("stalker");
  const { id } = await (await post("/api/maps", { name: `Hall ${unique()}`, rows: openMap(13, 11) }, hostCookie)).json();
  const room = await newRoom();
  const host = await open(hostCookie, room);
  const prey = await open(await signUp("prey"), room);
  const watcher = await open(await signUp("watcher"), room);
  await within(1000, () => host.messages.find((m) => m.t === "roster" && m.players.length === 3));
  host.ws.send(JSON.stringify({ t: "map", id }));
  await within(1000, () => host.messages.find((m) => m.t === "roster" && m.map?.id === id));
  host.ws.send(JSON.stringify({ t: "start" }));
  await within(5000, () => host.messages.find((m) => m.t === "state" && m.phase === "playing"));
  const preyId = prey.messages.find((m) => m.t === "hello").id;
  // the prey looks away from the host and stands still; the host walks up behind with the torch on
  await within(15_000, () => {
    const h = host.messages.findLast((m) => m.t === "state")?.me;
    const p = prey.messages.findLast((m) => m.t === "state")?.me;
    if (!h || !p) return undefined;
    if (p.status !== "alive") return true;
    const toPrey = Math.atan2(p.y - h.y, p.x - h.x);
    prey.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, aim: toPrey }));
    const far = Math.hypot(p.x - h.x, p.y - h.y) > 2;
    host.ws.send(JSON.stringify({ t: "input", dx: far ? Math.cos(toPrey) : 0, dy: far ? Math.sin(toPrey) : 0, aim: toPrey }));
    return undefined;
  });
  const told = (c: Client) => c.messages.find((m) => m.t === "catch" && m.caughtId === preyId);
  const theirs = await within(1000, () => told(prey));
  const others = await within(1000, () => told(watcher));
  expect(theirs).toMatchObject({ catcher: "stalker", caught: "prey", from: "behind" });
  expect(others).toMatchObject({ catcher: "stalker", caught: "prey", from: null });
  for (const c of [host, prey, watcher]) c.ws.close();
}, 25_000);

it("only the host's pick counts, and a map that isn't in the library is ignored", async () => {
  const room = await newRoom();
  const host = await open(await signUp("boss"), room);
  const guestCookie = await signUp("meddler");
  const guest = await open(guestCookie, room);
  const { id } = await (await post("/api/maps", { name: "Meddling", rows: openMap() }, guestCookie)).json();
  await within(1000, () => host.messages.find((m) => m.t === "roster" && m.players.length === 2));
  guest.ws.send(JSON.stringify({ t: "map", id }));
  host.ws.send(JSON.stringify({ t: "map", id: 999999 }));
  await new Promise((r) => setTimeout(r, 300));
  expect(host.messages.filter((m) => m.t === "roster").every((m) => m.map === null)).toBe(true);
  host.ws.close();
  guest.ws.close();
});

it("How to play shows the catch, the stun, the flash and the freeze, each with a description and its own Play button", async () => {
  const { JSDOM } = await import("jsdom");
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const help = new JSDOM(html).window.document.getElementById("panel-help")!;
  for (const id of ["demo-catch", "demo-stun", "demo-flash", "demo-freeze"]) {
    const canvas = help.querySelector(`canvas#${id}`);
    expect(canvas, `${id} is in How to play`).not.toBeNull();
    expect(canvas!.getAttribute("role")).toBe("img");
    expect(canvas!.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(20);
    const play = help.querySelector(`[data-play="${id}"]`);
    expect(play?.getAttribute("aria-label"), `${id}'s Play button names its demo`).toMatch(/^Play the \w+ demo$/);
  }
});
