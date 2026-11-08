import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";
import { cues, moodOf, type Heard } from "../client/cues.ts";

const baseUrl = inject("baseUrl");

// A state as one player receives it, with whatever this test cares about changed.
function heard(over: Partial<Heard> = {}, me: Partial<NonNullable<Heard["me"]>> = {}): Heard {
  return {
    phase: "playing",
    remainingMs: 0,
    flashMs: 0,
    me: { status: "alive", lit: false, cooldownHeld: false, cooldownMs: 0, item: null, frozenMs: 0, ...me },
    zone: { x: 5, y: 5, r: 20, closesInMs: 30_000 },
    ...over,
  };
}
const ME = { id: "me" };

describe("sound follows only what you're told", () => {
  it("a catch you see plays the catch cue", () => {
    const s = heard();
    expect(cues(s, s, { t: "catch", catcherId: "ann", caughtId: "bob" }, ME)).toEqual(["catch"]);
  });

  it("being caught plays the caught cue, not the catch cue", () => {
    const s = heard();
    expect(cues(s, s, { t: "catch", catcherId: "ann", caughtId: "me" }, ME)).toEqual(["caught"]);
  });

  it("your own fall plays the fall cue", () => {
    const s = heard();
    expect(cues(s, s, { t: "catch", catcherId: null, caughtId: "me" }, ME)).toEqual(["fell"]);
  });

  it("a player you can't see makes no sound", () => {
    // a rival moving, picking up, freezing and stunning out of view changes
    // nothing in your state but the clock, so nothing plays
    const before = heard({ remainingMs: 0 });
    const after = { ...heard({ remainingMs: 0 }), others: [{ id: "far", x: 1, y: 1 }] } as Heard;
    expect(cues(before, after, undefined, ME)).toEqual([]);
    expect(cues(before, heard(), { t: "roster" }, ME)).toEqual([]);
  });

  it("a flash plays for everyone at once, in the round or out of it", () => {
    for (const status of ["alive", "caught", "spectating"] as const) {
      const before = heard({ flashMs: 0 }, { status });
      const after = heard({ flashMs: 1000 }, { status });
      expect(cues(before, after, undefined, ME), status).toContain("flash");
    }
    // and the fade after it is the same flash, not a new one
    expect(cues(heard({ flashMs: 1000 }), heard({ flashMs: 950 }), undefined, ME)).not.toContain("flash");
  });

  it("each count before lights out ticks once, and lights out plays the start", () => {
    const at = (ms: number) => heard({ phase: "countdown", remainingMs: ms, zone: null });
    expect(cues(heard({ phase: "waiting", zone: null }), at(3000), undefined, ME)).toEqual(["countdown"]);
    expect(cues(at(3000), at(2950), undefined, ME)).toEqual([]);
    expect(cues(at(2050), at(1990), undefined, ME)).toEqual(["countdown"]);
    expect(cues(at(50), heard(), undefined, ME)).toEqual(["start"]);
  });

  it("filling your slot plays the pickup cue; swapping one powerup for another does too", () => {
    expect(cues(heard(), heard({}, { item: "speed" }), undefined, ME)).toEqual(["pickup"]);
    expect(cues(heard({}, { item: "speed" }), heard({}, { item: "freeze" }), undefined, ME)).toEqual(["pickup"]);
    expect(cues(heard({}, { item: "speed" }), heard(), undefined, ME)).toEqual([]);
  });

  it("using a powerup plays the use cue, and a refusal plays the refused cue", () => {
    const s = heard();
    expect(cues(s, s, { t: "used", kind: "speed", ok: true }, ME)).toEqual(["use"]);
    expect(cues(s, s, { t: "used", kind: "freeze", ok: true }, ME)).toEqual(["use", "freeze"]);
    expect(cues(s, s, { t: "used", kind: "freeze", ok: false }, ME)).toEqual(["refused"]);
    expect(cues(s, s, { t: "used", kind: null, ok: false }, ME)).toEqual([]);
  });

  it("being frozen, stunned or caught in a beam each play once, as it starts", () => {
    expect(cues(heard(), heard({}, { frozenMs: 5000 }), undefined, ME)).toEqual(["freeze"]);
    expect(cues(heard({}, { frozenMs: 5000 }), heard({}, { frozenMs: 4950 }), undefined, ME)).toEqual([]);
    expect(cues(heard(), heard({}, { cooldownHeld: true }), undefined, ME)).toEqual(["stun"]);
    expect(cues(heard({}, { cooldownHeld: true }), heard({}, { cooldownMs: 2900 }), undefined, ME)).toEqual([]);
    expect(cues(heard(), heard({}, { lit: true }), undefined, ME)).toEqual(["lit"]);
    expect(cues(heard({}, { lit: true }), heard({}, { lit: true }), undefined, ME)).toEqual([]);
  });

  it("the last one standing hears the win, everyone else who played hears the loss", () => {
    const ended = (status: "alive" | "caught") => heard({ phase: "ended", zone: null }, { status });
    expect(cues(heard(), ended("alive"), undefined, ME)).toEqual(["win"]);
    expect(cues(heard({}, { status: "caught" }), ended("caught"), undefined, ME)).toEqual(["lose"]);
    const watching = heard({}, { status: "spectating" });
    expect(cues(watching, { ...watching, phase: "ended" }, undefined, ME)).toEqual([]);
  });

  it("in teams, your side winning is a win even if you were caught", () => {
    const before = heard({}, { status: "caught" });
    const after = heard({ phase: "ended", zone: null }, { status: "caught" });
    expect(cues(before, after, undefined, { id: "me", team: "red", winnerTeam: "red" })).toEqual(["win"]);
    expect(cues(before, after, undefined, { id: "me", team: "red", winnerTeam: "blue" })).toEqual(["lose"]);
  });

  it("the music is calm in the lobby, pulses as the dark closes in, and stops at round end", () => {
    const maze = { w: 21, h: 21 };
    expect(moodOf(heard({ phase: "waiting", zone: null }), maze)).toEqual({ playing: true, pulse: 0 });
    const early = moodOf(heard({ zone: { x: 10, y: 10, r: 30, closesInMs: 50_000 } }), maze).pulse;
    const closing = moodOf(heard({ zone: { x: 10, y: 10, r: 6, closesInMs: 0 } }), maze).pulse;
    expect(early).toBe(0);
    expect(closing).toBeGreaterThan(0.5);
    expect(moodOf(heard({ phase: "ended", zone: null }), maze).playing).toBe(false);
  });
});

it("the HUD has a sound toggle", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  const hud = new JSDOM(html).window.document.querySelector(".hud-line")!;
  const toggle = hud.querySelector<HTMLButtonElement>("button#sound");
  expect(toggle, "a Sound button sits with the other HUD buttons").not.toBeNull();
  expect(toggle!.classList.contains("hud-button")).toBe(true);
  expect(toggle!.textContent?.trim()).toMatch(/^Sound (on|off)$/);
  expect(toggle!.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
});
