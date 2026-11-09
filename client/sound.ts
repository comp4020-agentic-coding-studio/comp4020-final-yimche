// Every sound in the game, made in the browser with Web Audio: no files, no
// downloads. One AudioContext, started on the first key press or tap (the
// browser refuses sound before one), feeding a master gain through a music
// bus and an effects bus, then a limiter so nothing ever clips.
//
// The synth functions take any BaseAudioContext and a destination node, so
// the same code renders offline for checking peaks as plays live.

import { CUES, type Cue, type Mood } from "./cues.ts";

// small building blocks

const A_MINOR = [57, 60, 62, 64, 67, 69, 72]; // A minor pentatonic, as MIDI notes
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// One shaped note: an oscillator through a gain with a quick attack and an
// exponential fall, so it starts and ends without a click.
function tone(
  ac: BaseAudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
  glideTo?: number,
): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

// A burst of filtered noise, for the crunch of a fall or the hiss of frost.
function noise(ac: BaseAudioContext, out: AudioNode, at: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, toFreq?: number): void {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0; // seeded, so a render is repeatable
    data[i] = (seed / 2 ** 32) * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, at);
  if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

// the effects

// Each cue, scheduled at `at` into `out`. Loudness is set here; the bus and
// the limiter keep the sum in range.
export function playCue(ac: BaseAudioContext, out: AudioNode, cue: Cue, at = ac.currentTime): void {
  switch (cue) {
    case "countdown": // a dry tick for each count
      tone(ac, out, at, 880, 0.12, 0.5, "triangle");
      break;
    case "start": // lights out: a falling sweep into the dark
      tone(ac, out, at, 660, 0.7, 0.18, "triangle", 110);
      tone(ac, out, at, 330, 0.9, 0.3, "sine", 55);
      break;
    case "flash": // a bright shimmer that fades with the light
      for (const [i, m] of [84, 88, 91].entries()) tone(ac, out, at + i * 0.03, hz(m), 0.9, 0.12, "sine");
      noise(ac, out, at, 0.6, 0.08, "highpass", 6000);
      break;
    case "pickup": // two rising notes
      tone(ac, out, at, hz(76), 0.12, 0.3, "triangle");
      tone(ac, out, at + 0.08, hz(83), 0.2, 0.3, "triangle");
      break;
    case "use": // a quick upward whoosh
      tone(ac, out, at, 300, 0.25, 0.3, "triangle", 900);
      break;
    case "freeze": // glassy high notes over a hiss of frost
      for (const [i, m] of [96, 91, 98].entries()) tone(ac, out, at + i * 0.05, hz(m), 0.5, 0.12, "sine");
      noise(ac, out, at, 0.5, 0.12, "bandpass", 8000, 3000);
      break;
    case "refused": // a low double buzz, no
      tone(ac, out, at, 140, 0.1, 0.25, "square");
      tone(ac, out, at + 0.13, 120, 0.14, 0.25, "square");
      break;
    case "stun": // a dull thud with a ring after it
      tone(ac, out, at, 160, 0.25, 0.45, "sine", 60);
      tone(ac, out, at + 0.02, 1200, 0.5, 0.08, "sine", 1150);
      break;
    case "lit": // a tense two-note warning
      tone(ac, out, at, hz(81), 0.14, 0.25, "square");
      tone(ac, out, at + 0.15, hz(80), 0.18, 0.25, "square");
      break;
    case "catch": // someone else is out: a soft low bell
      tone(ac, out, at, hz(57), 0.8, 0.3, "sine");
      tone(ac, out, at, hz(64), 0.8, 0.15, "sine");
      break;
    case "caught": // you're out: a falling minor chord
      for (const m of [69, 72, 76]) tone(ac, out, at, hz(m), 1.2, 0.18, "triangle", hz(m - 12));
      break;
    case "fell": // the floor gives: a crunch and a long drop
      noise(ac, out, at, 0.4, 0.4, "lowpass", 1500, 200);
      tone(ac, out, at + 0.05, 500, 1.2, 0.3, "sine", 40);
      break;
    case "win": // a rising major arpeggio, held
      for (const [i, m] of [69, 73, 76, 81].entries()) tone(ac, out, at + i * 0.12, hz(m), 1.2 - i * 0.12, 0.22, "triangle");
      break;
    case "lose": // a slow falling minor line
      for (const [i, m] of [69, 67, 64, 57].entries()) tone(ac, out, at + i * 0.22, hz(m), 0.5, 0.18, "triangle");
      break;
  }
}

// the music

// A low drone under a slow, sparse melody in A minor, and a soft pulse that
// grows as the dark closes in. Built once per context; `setMood` steers it.
export interface Music {
  setMood(mood: Mood): void;
  // schedules what's due up to `until` (seconds on the context's clock)
  schedule(until: number): void;
}

export function makeMusic(ac: BaseAudioContext, out: AudioNode, seed = 7): Music {
  const bus = ac.createGain();
  bus.gain.value = 0;
  bus.connect(out);

  // the drone: two detuned saws on A, low-passed to a hum
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 260;
  const drone = ac.createGain();
  drone.gain.value = 0.1;
  lp.connect(drone).connect(bus);
  for (const [f, d] of [[hz(33), -6], [hz(45), 5]]) {
    const o = ac.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = d;
    o.connect(lp);
    o.start();
  }

  // the pulse: a soft low thump, on a gain the mood opens
  const pulseBus = ac.createGain();
  pulseBus.gain.value = 0;
  pulseBus.connect(bus);

  // the closing track: once the floor has actually started falling away, a
  // driving bassline and a ticking hat take over underneath the drone,
  // crossfading in over a couple of seconds on a gain of its own
  const closingBus = ac.createGain();
  closingBus.gain.value = 0;
  closingBus.connect(bus);
  const EIGHTH = 60 / 140 / 2; // seconds, a driving 140 bpm
  const BASS_LINE = [45, 45, 48, 45, 52, 45, 48, 50]; // MIDI, a short loop under A minor
  let bassAt = ac.currentTime + 1;
  let step = 0;

  let rand = seed;
  const next = () => ((rand = (rand * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let noteAt = ac.currentTime + 1;
  let beatAt = ac.currentTime + 0.5;
  let pulse = 0;
  let last = 3;

  return {
    setMood(mood) {
      const t = ac.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(mood.playing ? 1 : 0, t, mood.playing ? 1.5 : 0.15);
      pulse = mood.pulse;
      pulseBus.gain.setTargetAtTime(pulse, t, 1);
      closingBus.gain.setTargetAtTime(mood.closing ? 1 : 0, t, 0.7);
    },
    schedule(until) {
      // melody: a note every two to four seconds, stepping near the last
      while (noteAt < until) {
        last = Math.max(0, Math.min(A_MINOR.length - 1, last + Math.round((next() - 0.5) * 4)));
        if (next() > 0.25) tone(ac, bus, noteAt, hz(A_MINOR[last]), 2.4, 0.07, "triangle");
        noteAt += 2 + Math.floor(next() * 3);
      }
      // pulse: quicker as the dark closes in, a beat every 0.9 s down to 0.45 s
      while (beatAt < until) {
        tone(ac, pulseBus, beatAt, 55, 0.3, 0.3, "sine", 40);
        // an octave and two up, quietly, so a phone's small speaker still
        // carries the beat its low thump is too deep for
        tone(ac, pulseBus, beatAt, 220, 0.15, 0.08, "triangle", 165);
        beatAt += 0.9 - 0.45 * pulse;
      }
      // the closing bassline: an eighth-note walk, with a ticking hat on
      // the off-beats and an octave-up layer so a phone speaker still carries it
      while (bassAt < until) {
        const note = BASS_LINE[step % BASS_LINE.length];
        tone(ac, closingBus, bassAt, hz(note), EIGHTH * 0.9, 0.2, "sawtooth");
        tone(ac, closingBus, bassAt, hz(note + 12), EIGHTH * 0.9, 0.05, "triangle");
        if (step % 2 === 1) noise(ac, closingBus, bassAt, 0.05, 0.1, "highpass", 7000);
        bassAt += EIGHTH;
        step++;
      }
    },
  };
}

// live playback

// The chain: music and effects buses into a master gain, then a limiter.
export function makeChain(ac: BaseAudioContext, dest: AudioNode = ac.destination) {
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  limiter.connect(dest);
  const master = ac.createGain();
  master.gain.value = 0.7;
  master.connect(limiter);
  const music = ac.createGain();
  music.gain.value = 0.25; // quiet under the effects
  music.connect(master);
  const effects = ac.createGain();
  effects.gain.value = 0.9;
  effects.connect(master);
  return { master, music, effects };
}

declare global {
  interface Window {
    __cues: string[];
  }
}
window.__cues = window.__cues ?? [];

const KEY = "torchlight.sound";
const load = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};
const save = (on: boolean): void => {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage refused; the choice lasts this visit
  }
};

let on = load();
let ac: AudioContext | null = null;
let chain: ReturnType<typeof makeChain> | null = null;
let music: Music | null = null;
let mood: Mood = { playing: false, pulse: 0, closing: false };
let timer = 0;

export const soundOn = () => on;

// Starts the context, or wakes it, on a key press or tap. Muted, nothing is made.
export function wake(): void {
  if (!on || document.hidden) return;
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return;
    }
    chain = makeChain(ac);
    music = makeMusic(ac, chain.music, Date.now() >>> 0);
    music.setMood(mood);
    timer = window.setInterval(() => music?.schedule(ac!.currentTime + 1), 250);
  }
  if (ac.state === "suspended") void ac.resume();
}

// Plays the cues a moment calls for. Each is recorded for the testers' driver
// whenever sound is on, even before the first gesture lets the context start.
// A beam sweeping on and off your back warns once, not every tick; and the
// win or lose comes just after a catch that ended the round, not on top of it.
const LIT_GAP_MS = 1500;
const END_DELAY_S = 0.6;
let litAt = -Infinity;
let outAt = -Infinity; // when the last catch or fall sounded
export function play(list: Cue[]): void {
  if (!on) return;
  for (const c of list) {
    if (!CUES.includes(c)) continue;
    if (c === "lit") {
      if (performance.now() - litAt < LIT_GAP_MS) continue;
      litAt = performance.now();
    }
    window.__cues.push(c);
    const now = performance.now();
    if (c === "catch" || c === "caught" || c === "fell") outAt = now;
    // the catch message and the round's end arrive a tick apart at most
    const later = (c === "win" || c === "lose") && now - outAt < 500 ? END_DELAY_S : 0;
    if (ac && chain && ac.state === "running") playCue(ac, chain.effects, c, ac.currentTime + later);
  }
}

export function setMood(m: Mood): void {
  if (m.playing === mood.playing && m.closing === mood.closing && Math.abs(m.pulse - mood.pulse) < 0.02) return;
  mood = m;
  music?.setMood(m);
}

export function setSound(next: boolean): void {
  on = next;
  save(on);
  if (!on && ac) {
    window.clearInterval(timer);
    void ac.close();
    ac = chain = music = null;
  }
  if (on) wake();
}

// A hidden tab goes quiet, and picks up again when it's shown.
document.addEventListener("visibilitychange", () => {
  if (!ac) return;
  if (document.hidden) void ac.suspend();
  else void ac.resume();
});
