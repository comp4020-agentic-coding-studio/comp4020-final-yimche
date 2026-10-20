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
