// The shared library as a table: a picture of each map, its name, who drew
// it, its size and when. The host picks one for the room from here, and the
// editor opens one to copy. The dialog opens at once and fills in as the list
// arrives; each picture is fetched only when its row scrolls into view.

import type { Theme } from "../shared/maps.ts";
import { LOOKS } from "./themes.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MapSummary {
  id: number;
  name: string;
  author: string;
  w: number;
  h: number;
  theme: Theme;
  createdAt: number;
}


// A map's rows never change once saved, so each is fetched once a visit.
const rowCache = new Map<number, Promise<string[]>>();
export function mapRows(id: number): Promise<string[]> {
  let rows = rowCache.get(id);
  if (!rows) {
    rows = fetch(`/api/maps/${id}`)
      .then((r) => r.json())
      .then((m: { rows: string[] }) => m.rows);
    rows.catch(() => rowCache.delete(id)); // a failed fetch is tried again next time
    rowCache.set(id, rows);
  }
  return rows;
}

// One pixel a square, in the map's theme; the page scales it up crisp.
function drawThumb(canvas: HTMLCanvasElement, rows: string[], theme: Theme): void {
  const look = LOOKS[theme] ?? LOOKS.night;
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d")!;
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      ctx.fillStyle = c === "#" ? look.wall : look.floor;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
}

// "3 days ago", "yesterday", "just now"
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 864e5],
  ["month", 30 * 864e5],
  ["week", 7 * 864e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];
export function ago(at: number, now = Date.now()): string {
  const ms = now - at;
  for (const [unit, size] of STEPS) if (ms >= size) return relative.format(-Math.floor(ms / size), unit);
  return "just now";
}

const cell = (cls: string, ...kids: (Node | string)[]) => {
  const td = document.createElement("td");
  td.className = cls;
  td.append(...kids);
  return td;
};
const small = (cls: string, text: string) => {
  const s = document.createElement("small");
  s.className = cls;
  s.textContent = text;
  return s;
};

interface Options {
  title: string;
  note: string;
  fresh: boolean; // offer "Fresh maze" as the first row, and point to the editor
  current?: number | null; // what the room plays now, marked as Playing
  pick: (id: number | null) => void;
}

const dialog = () => $<HTMLDialogElement>("maps");
let seen: IntersectionObserver | null = null;

export async function openMapTable(o: Options): Promise<void> {
  const body = $("map-rows");
  const filter = $<HTMLInputElement>("maps-filter");
  $("maps-h").textContent = o.title;
  $("maps-note").textContent = o.note;
  // from inside the editor there's no point sending you to it
  for (const a of $("maps").querySelectorAll<HTMLElement>(".to-editor")) a.hidden = !o.fresh;
  filter.value = "";
  body.replaceChildren();
  body.closest("table")!.hidden = false;
  $("maps-empty").hidden = true;
  $("maps-status").textContent = "Fetching the library";
  $("maps-status").hidden = false;
  if (!dialog().open) dialog().showModal();

  let maps: MapSummary[] = [];
  try {
    maps = ((await (await fetch("/api/maps")).json()) as { maps: MapSummary[] }).maps;
  } catch {
    $("maps-status").textContent = "The library didn't answer. Close this and try again.";
    return;
  }
  $("maps-status").hidden = true;

  // pictures load as their rows come into view in the scrolling body
  seen?.disconnect();
  seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const canvas = e.target as HTMLCanvasElement;
        seen!.unobserve(canvas);
        mapRows(Number(canvas.dataset.id)).then((rows) => drawThumb(canvas, rows, canvas.dataset.theme as Theme), () => {});
      }
    },
    { root: $("maps-scroll"), rootMargin: "200px 0px" },
  );

  const now = Date.now();
  const row = (id: number | null, name: string, thumb: HTMLElement, sub: string, by: string, size: string, added: string) => {
    const tr = document.createElement("tr");
    const playing = o.current !== undefined && o.current === id;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "map-choose";
    b.textContent = name;
    if (playing) {
      b.setAttribute("aria-current", "true");
      tr.classList.add("playing");
      b.append(small("tag", "Playing"));
    }
    b.addEventListener("click", () => o.pick(id));
    // the whole row picks, though only its button takes focus
    tr.addEventListener("click", (e) => {
      if (e.target !== b && !b.contains(e.target as Node)) b.click();
    });
    tr.dataset.find = `${name} ${by}`.toLowerCase();
    tr.append(
      cell("thumb", thumb),
      cell("name", b, small("sub", sub)),
      cell("by", by),
      cell("size", size),
      cell("added", added),
    );
    return tr;
  };

  const rows: HTMLTableRowElement[] = [];
  if (o.fresh) {
    const blank = document.createElement("span");
    blank.className = "fresh-thumb";
    blank.textContent = "?";
    const fresh = row(null, "Fresh maze", blank, "A new maze each round, sized for the room", "", "", "");
    fresh.classList.add("fresh");
    rows.push(fresh);
  }
  for (const m of maps) {
    const canvas = document.createElement("canvas");
    canvas.dataset.id = String(m.id);
    canvas.dataset.theme = m.theme;
    canvas.setAttribute("aria-hidden", "true");
    // a placeholder the right shape until the picture arrives
    canvas.width = m.w;
    canvas.height = m.h;
    const size = `${m.w} × ${m.h}`;
    const added = ago(m.createdAt, now);
    rows.push(row(m.id, m.name, canvas, `by ${m.author}, ${added}`, m.author, size, added));
  }
  body.replaceChildren(...rows);
  body.closest("table")!.hidden = rows.length === 0;
  for (const c of body.querySelectorAll<HTMLCanvasElement>("canvas")) seen.observe(c);
  $("maps-empty").hidden = maps.length > 0;
  (body.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? body.querySelector("button"))?.focus();
}

// Typing in the box keeps the maps whose name or maker match; Fresh maze
// always stays, since it's never the thing being searched for.
function applyFilter(): void {
  const q = $<HTMLInputElement>("maps-filter").value.trim().toLowerCase();
  let shown = 0;
  let maps = 0;
  for (const tr of $("map-rows").querySelectorAll<HTMLTableRowElement>("tr")) {
    if (tr.classList.contains("fresh")) continue;
    maps++;
    const hit = tr.dataset.find!.includes(q);
    tr.hidden = !hit;
    if (hit) shown++;
  }
  const status = $("maps-status");
  status.hidden = maps === 0 || shown > 0;
  status.textContent = `No maps match "${q}"`;
}

// Up and Down move between rows, so the table reads like a list from the keys.
function step(e: KeyboardEvent): void {
  const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!d) return;
  const buttons = [...$("map-rows").querySelectorAll<HTMLButtonElement>("tr:not([hidden]) button")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at === -1 && document.activeElement !== $("maps-filter")) return;
  e.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, at + d))]?.focus();
}

// Wired once, for whichever page opened the table.
export function wireMapTable(onClose: () => void): void {
  const d = dialog();
  $("maps-filter").addEventListener("input", applyFilter);
  d.addEventListener("keydown", step);
  $("maps-close").addEventListener("click", () => d.close());
  // a click on the backdrop lands on the dialog itself, outside its box
  d.addEventListener("click", (e) => {
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (e.target === d && !inside) d.close();
  });
  d.addEventListener("close", () => {
    seen?.disconnect();
    onClose();
  });
}
