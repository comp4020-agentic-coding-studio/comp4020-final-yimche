import { MAP_MAX, MAP_MIN, isSpot, mapProblem, unreachable } from "../shared/maps.ts";

// The map editor, at /?edit. A grid of walls and floor you paint by clicking
// or dragging, with the same checks the server makes shown live as you draw,
// so a map that reads as ready here is one the library will take. Nothing is
// decided here that matters to a round: the server checks the map again when
// it's saved, and plays it as drawn.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// the same night the game is drawn in, so a map looks here as it will in play
const NIGHT = { floor: "#46536f", grout: "#3a4660", wall: "#121722", edge: "#5a6888", void: "#04050a" };

export function startEditor(): void {
  document.title = "Map editor · Torchlight";
  document.querySelector<HTMLElement>(".stage")!.hidden = true;
  $("editor").hidden = false;
  const canvas = $<HTMLCanvasElement>("grid");
  const ctx = canvas.getContext("2d")!;
  let rows = walled(21, 21);
  let tool = "#";
  let scale = 1;
  let offX = 0;
  let offY = 0;

  // ---------- the grid ----------

  // A blank map: wall all round, floor inside.
  function walled(w: number, h: number): string[] {
    return Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? "#".repeat(w) : "#" + ".".repeat(w - 2) + "#"));
  }

  // Changing the size keeps what's drawn where it still fits, and walls the new edge.
  function resizeTo(w: number, h: number): void {
    rows = Array.from({ length: h }, (_, y) =>
      [...Array(w)].map((_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? "#" : (rows[y]?.[x] ?? "."))).join(""),
    );
    changed();
  }

  // A maze to start from: rooms on the odd squares joined by a random walk,
  // with some extra walls knocked out so there are loops. A starting point to
  // paint over, not the game's own maze.
  function randomMaze(w: number, h: number): string[] {
    const grid = Array.from({ length: h }, () => Array(w).fill("#"));
    const cw = (w - 1) / 2;
    const ch = (h - 1) / 2;
    const seen = new Set<number>([0]);
    const stack: [number, number][] = [[0, 0]];
    grid[1][1] = ".";
    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => [cx + dx, cy + dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < cw && y < ch && !seen.has(y * cw + x));
      if (next.length === 0) {
        stack.pop();
        continue;
      }
      const [nx, ny] = next[Math.floor(Math.random() * next.length)];
      seen.add(ny * cw + nx);
      grid[ny * 2 + 1][nx * 2 + 1] = ".";
      grid[cy + ny + 1][cx + nx + 1] = ".";
      stack.push([nx, ny]);
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) if ((x % 2 === 0) !== (y % 2 === 0) && Math.random() < 0.25) grid[y][x] = ".";
    }
    return grid.map((r) => r.join(""));
  }

  function paint(x: number, y: number): void {
    // the outside edge always stays wall
    if (x <= 0 || y <= 0 || x >= rows[0].length - 1 || y >= rows.length - 1) return;
    if (rows[y][x] === tool) return;
    rows[y] = rows[y].slice(0, x) + tool + rows[y].slice(x + 1);
    changed();
  }

  // ---------- drawing ----------

  function layout(): void {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const w = rows[0].length;
    const h = rows.length;
    scale = Math.min(canvas.width / w, canvas.height / h);
    offX = (canvas.width - w * scale) / 2;
    offY = (canvas.height - h * scale) / 2;
    draw();
  }
  new ResizeObserver(layout).observe(canvas);

  // Tiles as the game draws them. A dot marks each spot (where players and
  // powerups can appear), brighter when it's open, and floor that can't be
  // reached from the rest is washed red.
  function draw(): void {
    const w = rows[0].length;
    const h = rows.length;
    const sealed = unreachable(rows);
    ctx.fillStyle = NIGHT.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = offX + x * scale;
        const py = offY + y * scale;
        if (rows[y][x] === "#") {
          ctx.fillStyle = NIGHT.wall;
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          if (rows[y + 1]?.[x] === ".") {
            ctx.fillStyle = NIGHT.edge;
            ctx.fillRect(px, py + scale * 0.82, scale + 0.5, scale * 0.18 + 0.5);
          }
        } else {
          const gap = Math.max(1, scale * 0.04);
          ctx.fillStyle = NIGHT.grout;
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          ctx.fillStyle = NIGHT.floor;
          ctx.fillRect(px + gap, py + gap, scale - gap, scale - gap);
          if (sealed.has(`${x},${y}`)) {
            ctx.fillStyle = "rgb(220 70 60 / 0.45)";
            ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
          }
        }
        if (isSpot(x, y)) {
          ctx.fillStyle = rows[y][x] === "." ? "rgb(255 236 196 / 0.55)" : "rgb(255 255 255 / 0.12)";
          ctx.beginPath();
          ctx.arc(px + scale / 2, py + scale / 2, Math.max(1.5, scale * 0.09), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Redraws, and says whether the map is ready or what's in the way, in the
  // same words the server would use.
  function changed(): void {
    draw();
    const problem = mapProblem(rows);
    $("ed-status").textContent = problem ?? `Ready to save: ${rows[0].length} by ${rows.length}`;
    $("ed-status").classList.toggle("bad", problem !== null);
    $<HTMLInputElement>("ed-w").value = String(rows[0].length);
    $<HTMLInputElement>("ed-h").value = String(rows.length);
  }

  // ---------- painting ----------

  const tileAt = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    return [Math.floor(((e.clientX - r.left) * dpr - offX) / scale), Math.floor(((e.clientY - r.top) * dpr - offY) / scale)];
  };
  let painting = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    painting = true;
    paint(...tileAt(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (painting) paint(...tileAt(e));
  });
  const stop = () => (painting = false);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  const tools = document.querySelector<HTMLElement>('[aria-label="Paint with"]')!;
  tools.addEventListener("click", (e) => {
    const picked = (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.tool;
    if (!picked) return;
    tool = picked;
    for (const b of tools.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.tool === tool));
  });

  // sizes snap to the nearest odd number in range, since that's all a map can be
  const odd = (v: string) => {
    const n = Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round(Number(v)) || 21));
    return n % 2 === 0 ? n + 1 : n;
  };
  const sized = () => {
    resizeTo(odd($<HTMLInputElement>("ed-w").value), odd($<HTMLInputElement>("ed-h").value));
    layout();
  };
  $("ed-w").addEventListener("change", sized);
  $("ed-h").addEventListener("change", sized);
  $("ed-clear").addEventListener("click", () => {
    rows = walled(rows[0].length, rows.length);
    changed();
  });
  $("ed-maze").addEventListener("click", () => {
    rows = randomMaze(rows[0].length, rows.length);
    changed();
  });

  // ---------- the library ----------

  // Saving takes a name, as playing does; with none yet, the name form comes
  // first and the save carries on after it.
  async function save(): Promise<void> {
    const name = $<HTMLInputElement>("ed-name").value;
    const r = await fetch("/api/maps", { method: "POST", body: JSON.stringify({ name, rows }) });
    if (r.status === 401) {
      const join = $<HTMLDialogElement>("join");
      // the same name form as joining a game, worded for saving a map
      join.querySelector("h2")!.textContent = "Whose map is this?";
      join.querySelector<HTMLElement>(".join-or")!.hidden = true;
      join.querySelector('button[type="submit"]')!.textContent = "Save under this name";
      $("to-account").hidden = true;
      join.showModal();
      join.addEventListener("close", () => save(), { once: true });
      return;
    }
    const body = await r.json();
    $("ed-status").textContent = r.ok ? `Saved "${name.trim()}" to the library. Hosts can pick it in the lobby.` : body.error;
    $("ed-status").classList.toggle("bad", !r.ok);
  }
  $("ed-save").addEventListener("click", save);

  // Opening a map from the library starts a copy of it; saving makes a new map.
  $("ed-load").addEventListener("click", async () => {
    const { maps } = (await (await fetch("/api/maps")).json()) as {
      maps: { id: number; name: string; author: string; w: number; h: number }[];
    };
    const dialog = $<HTMLDialogElement>("maps");
    $("maps-h").textContent = "Open a map";
    $("maps-note").textContent = maps.length === 0 ? "Nobody has saved a map yet." : "Saving it again makes a new copy.";
    $("map-list").replaceChildren(
      ...maps.map((m) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "quiet";
        b.textContent = m.name;
        b.addEventListener("click", async () => {
          const map = (await (await fetch(`/api/maps/${m.id}`)).json()) as { name: string; rows: string[] };
          rows = map.rows;
          $<HTMLInputElement>("ed-name").value = map.name;
          dialog.close();
          layout();
          changed();
        });
        const small = document.createElement("small");
        small.textContent = `by ${m.author}, ${m.w} by ${m.h}`;
        li.append(b, small);
        return li;
      }),
    );
    dialog.showModal();
  });
  $("maps-close").addEventListener("click", () => $<HTMLDialogElement>("maps").close());

  layout();
  changed();
}
