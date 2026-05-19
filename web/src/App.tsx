import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";

// Battle-City-style 13×13 field, NES-era look. Two tiles per tank.

const COLS = 13;
const ROWS = 13;
const TILE_PX = 28; // logical pixels per tile — canvas scales via CSS
const FIELD_W = COLS * TILE_PX;
const FIELD_H = ROWS * TILE_PX;

const TANK_SIZE = 2 * TILE_PX;
const TANK_SPEED = 0.085; // px per ms — feels close to NES
const BULLET_SPEED = 0.32;
const FIRE_COOLDOWN = 380;

const ENEMY_GOAL = 8; // destroy this many to win
const START_LIVES = 3;

// Tile types
const T_EMPTY = 0;
const T_BRICK = 1;
const T_STEEL = 2;
const T_WATER = 3;
const T_BUSH = 4;
const T_EAGLE = 5;
type Tile = 0 | 1 | 2 | 3 | 4 | 5;

type Dir = "up" | "down" | "left" | "right";
const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

interface Tank {
  x: number;
  y: number;
  dir: Dir;
  isEnemy: boolean;
  alive: boolean;
  cooldown: number;
  aiTimer: number; // ms until next AI decision
}

interface Bullet {
  x: number;
  y: number;
  dir: Dir;
  ownerEnemy: boolean;
  alive: boolean;
}

interface GameState {
  field: Tile[][]; // [row][col]
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  spawnTimer: number;
  spawnQueue: number; // enemies left to spawn this level
  destroyed: number; // total enemies destroyed
  lives: number;
  baseAlive: boolean;
  gameOver: boolean;
  victory: boolean;
}

// Classic-ish Battle City layout. B=brick, S=steel, W=water, X=bush.
// Eagle (E) at bottom center, protected by a brick "house".
//
// Pad to 13 chars per row exactly.
const LAYOUT: string[] = [
  ".............",
  "..BB...BB....",
  "..BB...BB....",
  "BBBBBB.BBBBBB",
  "B.B.B.B.B.B.B",
  "...........X.",
  ".....SS......",
  ".X.....X.....",
  "BBBBBBBBBBBBB",
  "B.....B.....B",
  "B..B..B..B..B",
  "B..B..B..B..B",
  "BBBBBEBBBBBBB",
];

function parseField(): Tile[][] {
  const f: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Tile[] = [];
    const line = LAYOUT[r] ?? "";
    for (let c = 0; c < COLS; c++) {
      const ch = line[c] ?? ".";
      row.push(
        ch === "B" ? T_BRICK :
        ch === "S" ? T_STEEL :
        ch === "W" ? T_WATER :
        ch === "X" ? T_BUSH :
        ch === "E" ? T_EAGLE :
        T_EMPTY,
      );
    }
    f.push(row);
  }
  return f;
}

function tankAabb(t: Tank): { x: number; y: number; w: number; h: number } {
  return { x: t.x, y: t.y, w: TANK_SIZE, h: TANK_SIZE };
}

function intersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function tileAt(field: Tile[][], px: number, py: number): Tile {
  const c = Math.floor(px / TILE_PX);
  const r = Math.floor(py / TILE_PX);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T_STEEL; // off-field = wall
  return field[r]![c]!;
}

function blocksTank(t: Tile): boolean {
  return t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_EAGLE;
}

// Sample many points along the tank's leading edge to check for wall blockers.
function canTankOccupy(field: Tile[][], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + TANK_SIZE > FIELD_W || y + TANK_SIZE > FIELD_H) return false;
  // Check corners + midpoints (5 samples per side is plenty for tank-vs-tile)
  const eps = 1;
  const pts = [
    [x + eps, y + eps],
    [x + TANK_SIZE - eps, y + eps],
    [x + eps, y + TANK_SIZE - eps],
    [x + TANK_SIZE - eps, y + TANK_SIZE - eps],
    [x + TANK_SIZE / 2, y + eps],
    [x + TANK_SIZE / 2, y + TANK_SIZE - eps],
    [x + eps, y + TANK_SIZE / 2],
    [x + TANK_SIZE - eps, y + TANK_SIZE / 2],
  ] as const;
  for (const [px, py] of pts) {
    if (blocksTank(tileAt(field, px, py))) return false;
  }
  return true;
}

function freshState(): GameState {
  const field = parseField();
  return {
    field,
    player: {
      x: 4 * TILE_PX,
      y: 11 * TILE_PX,
      dir: "up",
      isEnemy: false,
      alive: true,
      cooldown: 0,
      aiTimer: 0,
    },
    enemies: [],
    bullets: [],
    spawnTimer: 600,
    spawnQueue: ENEMY_GOAL,
    destroyed: 0,
    lives: START_LIVES,
    baseAlive: true,
    gameOver: false,
    victory: false,
  };
}

function spawnEnemy(s: GameState): boolean {
  // Try the 3 standard spawn points at top of field
  const spots = [
    { x: 0, y: 0 },
    { x: (COLS / 2 - 1) * TILE_PX, y: 0 },
    { x: (COLS - 2) * TILE_PX, y: 0 },
  ];
  for (const spot of spots) {
    if (!canTankOccupy(s.field, spot.x, spot.y)) continue;
    // Don't overlap an existing tank
    const tryBox = { x: spot.x, y: spot.y, w: TANK_SIZE, h: TANK_SIZE };
    let overlap = false;
    for (const e of s.enemies) if (e.alive && intersects(tankAabb(e), tryBox)) { overlap = true; break; }
    if (s.player.alive && intersects(tankAabb(s.player), tryBox)) overlap = true;
    if (overlap) continue;
    s.enemies.push({
      x: spot.x,
      y: spot.y,
      dir: "down",
      isEnemy: true,
      alive: true,
      cooldown: 600,
      aiTimer: 200 + Math.random() * 600,
    });
    return true;
  }
  return false;
}

function tryMove(field: Tile[][], t: Tank, dx: number, dy: number): boolean {
  const nx = t.x + dx;
  const ny = t.y + dy;
  if (canTankOccupy(field, nx, ny)) {
    t.x = nx;
    t.y = ny;
    return true;
  }
  return false;
}

function fire(t: Tank, s: GameState): boolean {
  if (t.cooldown > 0) return false;
  t.cooldown = FIRE_COOLDOWN;
  const v = DIR_VEC[t.dir];
  const cx = t.x + TANK_SIZE / 2;
  const cy = t.y + TANK_SIZE / 2;
  const offset = TANK_SIZE / 2 + 2;
  s.bullets.push({
    x: cx + v.dx * offset - 2,
    y: cy + v.dy * offset - 2,
    dir: t.dir,
    ownerEnemy: t.isEnemy,
    alive: true,
  });
  return true;
}

// Damage a brick tile cluster: when a bullet hits brick, smash a small chunk
// around the impact (1 tile here for simplicity).
function damageWall(s: GameState, px: number, py: number): "brick" | "steel" | "base" | null {
  const c = Math.floor(px / TILE_PX);
  const r = Math.floor(py / TILE_PX);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  const t = s.field[r]![c]!;
  if (t === T_BRICK) {
    s.field[r]![c] = T_EMPTY;
    return "brick";
  }
  if (t === T_STEEL) return "steel";
  if (t === T_EAGLE) {
    s.baseAlive = false;
    s.gameOver = true;
    return "base";
  }
  return null;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshState());
  const inputRef = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean }>(
    { up: false, down: false, left: false, right: false, fire: false },
  );
  const lastTimeRef = useRef(0);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [destroyed, setDestroyed] = useState(0);
  const [phase, setPhase] = useState<"intro" | "playing" | "over" | "won">("intro");
  const [, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("tanks-best");
  const sounds = useGameSounds();

  const start = useCallback(() => {
    stateRef.current = freshState();
    setScore(0);
    setLives(START_LIVES);
    setDestroyed(0);
    setPhase("playing");
    force((x) => x + 1);
  }, []);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": case "w": case "W": inputRef.current.up = true; e.preventDefault(); break;
        case "ArrowDown": case "s": case "S": inputRef.current.down = true; e.preventDefault(); break;
        case "ArrowLeft": case "a": case "A": inputRef.current.left = true; e.preventDefault(); break;
        case "ArrowRight": case "d": case "D": inputRef.current.right = true; e.preventDefault(); break;
        case " ": case "Enter": case "k": case "K": inputRef.current.fire = true; e.preventDefault(); break;
      }
    };
    const up = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": case "w": case "W": inputRef.current.up = false; break;
        case "ArrowDown": case "s": case "S": inputRef.current.down = false; break;
        case "ArrowLeft": case "a": case "A": inputRef.current.left = false; break;
        case "ArrowRight": case "d": case "D": inputRef.current.right = false; break;
        case " ": case "Enter": case "k": case "K": inputRef.current.fire = false; break;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Canvas sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const maxW = parent.clientWidth;
      const maxH = parent.clientHeight;
      const scale = Math.min(maxW / FIELD_W, maxH / FIELD_H);
      const cssW = FIELD_W * scale;
      const cssH = FIELD_H * scale;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = FIELD_W * dpr;
      canvas.height = FIELD_H * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  // Main loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = lastTimeRef.current === 0 ? 16 : Math.min(40, now - lastTimeRef.current);
      lastTimeRef.current = now;
      if (phase === "playing") step(stateRef.current, dt);
      draw(stateRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const step = useCallback((s: GameState, dt: number) => {
    // ── Player input → movement + fire
    if (s.player.alive) {
      const inp = inputRef.current;
      let newDir: Dir | null = null;
      if (inp.up) newDir = "up";
      else if (inp.down) newDir = "down";
      else if (inp.left) newDir = "left";
      else if (inp.right) newDir = "right";
      if (newDir) {
        // Allow turning while moving: snap to grid on perpendicular turns for cleanness
        if (newDir !== s.player.dir) {
          if (newDir === "up" || newDir === "down") {
            s.player.x = Math.round(s.player.x / TILE_PX) * TILE_PX;
          } else {
            s.player.y = Math.round(s.player.y / TILE_PX) * TILE_PX;
          }
        }
        s.player.dir = newDir;
        const v = DIR_VEC[newDir];
        tryMove(s.field, s.player, v.dx * TANK_SPEED * dt, v.dy * TANK_SPEED * dt);
      }
      s.player.cooldown = Math.max(0, s.player.cooldown - dt);
      if (inp.fire && s.player.cooldown === 0) {
        if (fire(s.player, s)) sounds.playMove();
      }
    }

    // ── Enemy AI
    for (const e of s.enemies) {
      if (!e.alive) continue;
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        // Pick a new direction. Prefer toward base or player ~60% of the time.
        const targetX = Math.random() < 0.5 ? s.player.x : (COLS / 2 - 1) * TILE_PX;
        const targetY = Math.random() < 0.5 ? s.player.y : (ROWS - 2) * TILE_PX;
        const choices: Dir[] = ["up", "down", "left", "right"];
        if (Math.random() < 0.6) {
          const dx = targetX - e.x;
          const dy = targetY - e.y;
          if (Math.abs(dx) > Math.abs(dy)) {
            choices.unshift(dx > 0 ? "right" : "left");
          } else {
            choices.unshift(dy > 0 ? "down" : "up");
          }
        } else {
          // Shuffle
          for (let i = choices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [choices[i], choices[j]] = [choices[j]!, choices[i]!];
          }
        }
        e.dir = choices[0]!;
        e.aiTimer = 600 + Math.random() * 1200;
      }
      const v = DIR_VEC[e.dir];
      const moved = tryMove(s.field, e, v.dx * TANK_SPEED * 0.85 * dt, v.dy * TANK_SPEED * 0.85 * dt);
      if (!moved && e.aiTimer > 200) e.aiTimer = 100; // bounced — redecide soon
      // Fire toward player on alignment
      if (e.cooldown === 0 && Math.random() < 0.012) {
        fire(e, s);
      }
    }

    // ── Spawning
    if (s.spawnQueue > 0) {
      s.spawnTimer -= dt;
      if (s.spawnTimer <= 0 && s.enemies.filter((e) => e.alive).length < 3) {
        if (spawnEnemy(s)) s.spawnQueue--;
        s.spawnTimer = 1400;
      }
    }

    // ── Bullet update + collisions
    const liveBullets: Bullet[] = [];
    for (const b of s.bullets) {
      if (!b.alive) continue;
      const v = DIR_VEC[b.dir];
      b.x += v.dx * BULLET_SPEED * dt;
      b.y += v.dy * BULLET_SPEED * dt;
      const cx = b.x + 2;
      const cy = b.y + 2;
      if (cx < 0 || cx > FIELD_W || cy < 0 || cy > FIELD_H) continue;

      // Wall collision
      const wall = damageWall(s, cx, cy);
      if (wall) {
        if (wall === "brick") sounds.playMove();
        if (wall === "base") sounds.playGameOver();
        continue;
      }

      // Tank collisions
      const bbox = { x: b.x, y: b.y, w: 4, h: 4 };
      let hit = false;

      if (!b.ownerEnemy) {
        for (const e of s.enemies) {
          if (!e.alive) continue;
          if (intersects(bbox, tankAabb(e))) {
            e.alive = false;
            s.destroyed++;
            hit = true;
            sounds.playError();
            break;
          }
        }
      } else if (s.player.alive && intersects(bbox, tankAabb(s.player))) {
        s.player.alive = false;
        hit = true;
        sounds.playError();
      }

      if (!hit) liveBullets.push(b);
    }
    s.bullets = liveBullets;

    // ── Cull dead enemies (keep alive list lean)
    s.enemies = s.enemies.filter((e) => e.alive || s.bullets.length > 0); // keep until next pass
    s.enemies = s.enemies.filter((e) => e.alive);

    // ── Player respawn / lives / win / lose
    if (!s.player.alive && !s.gameOver) {
      if (s.lives > 1) {
        s.lives--;
        // Respawn at start tile
        s.player = {
          x: 4 * TILE_PX,
          y: 11 * TILE_PX,
          dir: "up",
          isEnemy: false,
          alive: true,
          cooldown: 600,
          aiTimer: 0,
        };
      } else {
        s.lives = 0;
        s.gameOver = true;
      }
    }
    if (!s.baseAlive) s.gameOver = true;
    if (s.destroyed >= ENEMY_GOAL && !s.gameOver) {
      s.gameOver = true;
      s.victory = true;
    }

    // ── React state sync (cheap diffs)
    if (s.destroyed !== destroyedRef.current) {
      destroyedRef.current = s.destroyed;
      setDestroyed(s.destroyed);
      setScore(s.destroyed * 100);
    }
    if (s.lives !== livesRef.current) {
      livesRef.current = s.lives;
      setLives(s.lives);
    }
    if (s.gameOver && phase === "playing") {
      const won = s.victory && s.baseAlive;
      setPhase(won ? "won" : "over");
      const final = s.destroyed * 100 + (won ? 500 : 0);
      setScore(final);
      updateHighScore(final);
      if (won) sounds.playLevelUp();
      else sounds.playGameOver();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sounds, updateHighScore]);

  const destroyedRef = useRef(0);
  const livesRef = useRef(START_LIVES);

  const draw = useCallback((s: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    // Tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = s.field[r]![c]!;
        if (t === T_EMPTY) continue;
        const x = c * TILE_PX;
        const y = r * TILE_PX;
        drawTile(ctx, x, y, t);
      }
    }

    // Bullets
    for (const b of s.bullets) {
      ctx.fillStyle = "#fde68a";
      ctx.fillRect(b.x, b.y, 4, 4);
    }

    // Tanks (player + enemies)
    if (s.player.alive) drawTank(ctx, s.player, "#facc15", "#1f2937");
    for (const e of s.enemies) {
      if (!e.alive) continue;
      drawTank(ctx, e, "#94a3b8", "#0f172a");
    }

    // Bushes go ON TOP of tanks (cover)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (s.field[r]![c] === T_BUSH) drawTile(ctx, c * TILE_PX, r * TILE_PX, T_BUSH);
      }
    }
  }, []);

  // ── Touch controls
  const setInput = (key: keyof typeof inputRef.current, v: boolean) => {
    inputRef.current[key] = v;
    if (key !== "fire" && v) {
      // Clear other directions when pressing a new one
      const others: Array<keyof typeof inputRef.current> = ["up", "down", "left", "right"];
      for (const o of others) if (o !== key) inputRef.current[o] = false;
    }
  };

  const PadBtn = ({ label, k }: { label: string; k: "up" | "down" | "left" | "right" }) => (
    <button
      onPointerDown={(e) => { e.preventDefault(); setInput(k, true); }}
      onPointerUp={() => setInput(k, false)}
      onPointerLeave={() => setInput(k, false)}
      onPointerCancel={() => setInput(k, false)}
      aria-label={k}
      style={{
        width: "3rem",
        height: "3rem",
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        borderRadius: "0.5rem",
        color: "var(--ink)",
        fontFamily: "Fraunces, serif",
        fontWeight: 700,
        fontSize: "1.25rem",
        touchAction: "manipulation",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {label}
    </button>
  );

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Tanks"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Lives", value: lives },
            { label: "Kills", value: `${destroyed}/${ENEMY_GOAL}` },
            { label: "Best", value: bestScore },
          ]}
          rules={
            <div>
              <h3 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>Tanks</h3>
              <p>Defend your eagle and destroy {ENEMY_GOAL} enemy tanks.</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Controls</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Desktop: ← ↑ → ↓ (or WASD) to move, Space / Enter / K to fire</li>
                <li>Mobile: D-pad bottom-left, Fire bottom-right</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Rules</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>3 lives. Lose all = game over</li>
                <li>If the eagle base is hit, you lose instantly — keep the bricks around it intact</li>
                <li>Brick walls crumble. Steel walls don't.</li>
                <li>Bushes hide tanks (cover both you and enemies)</li>
                <li>Survive bonus +500 for clearing all enemies with the base intact</li>
              </ul>
            </div>
          }
          actions={<GameAuth />}
        />
      }
    >
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0.5rem",
          gap: "0.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              imageRendering: "pixelated",
              background: "#0a0a0a",
              border: "1px solid var(--line)",
              borderRadius: "0.25rem",
              maxWidth: "100%",
              maxHeight: "100%",
              touchAction: "none",
            }}
          />
          {phase === "intro" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#facc15" }}>
                Defend the eagle
              </div>
              <GameButton size="md" variant="primary" onClick={start}>Start</GameButton>
            </Overlay>
          )}
          {phase === "over" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#ef4444" }}>
                Game Over
              </div>
              <div style={{ color: "#f8fafc" }}>Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={start}>Try Again</GameButton>
            </Overlay>
          )}
          {phase === "won" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#10b981" }}>
                Victory!
              </div>
              <div style={{ color: "#f8fafc" }}>Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={start}>Play Again</GameButton>
            </Overlay>
          )}
        </div>

        {/* Touch controls */}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: "0.5rem",
            paddingBottom: "0.25rem",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "0.25rem" }}>
            <span />
            <PadBtn label="▲" k="up" />
            <span />
            <PadBtn label="◀" k="left" />
            <span />
            <PadBtn label="▶" k="right" />
            <span />
            <PadBtn label="▼" k="down" />
            <span />
          </div>

          <button
            onPointerDown={(e) => { e.preventDefault(); inputRef.current.fire = true; }}
            onPointerUp={() => (inputRef.current.fire = false)}
            onPointerLeave={() => (inputRef.current.fire = false)}
            onPointerCancel={() => (inputRef.current.fire = false)}
            aria-label="Fire"
            style={{
              width: "4.5rem",
              height: "4.5rem",
              background: "var(--accent)",
              color: "var(--paper)",
              border: "none",
              borderRadius: "50%",
              fontFamily: "Fraunces, serif",
              fontWeight: 800,
              fontSize: "1.1rem",
              touchAction: "manipulation",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            FIRE
          </button>
        </div>

        <a
          href="https://freegamestore.online"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--muted)", fontSize: "0.7rem", textDecoration: "none" }}
        >
          Part of FreeGameStore — free forever
        </a>
      </div>
    </GameShell>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        background: "rgba(10,10,10,0.8)",
        borderRadius: "0.25rem",
      }}
    >
      {children}
    </div>
  );
}

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, t: Tile) {
  if (t === T_BRICK) {
    // 4-quadrant brick pattern
    ctx.fillStyle = "#a04020";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#7a2f17";
    const half = TILE_PX / 2;
    ctx.fillRect(x + 1, y + 1, half - 2, half - 2);
    ctx.fillRect(x + half + 1, y + 1, half - 2, half - 2);
    ctx.fillRect(x + 1, y + half + 1, half - 2, half - 2);
    ctx.fillRect(x + half + 1, y + half + 1, half - 2, half - 2);
  } else if (t === T_STEEL) {
    ctx.fillStyle = "#9aa0a6";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#d1d5db";
    ctx.fillRect(x + 2, y + 2, TILE_PX - 4, TILE_PX - 4);
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(x + TILE_PX / 2 - 1, y + 2, 2, TILE_PX - 4);
    ctx.fillRect(x + 2, y + TILE_PX / 2 - 1, TILE_PX - 4, 2);
  } else if (t === T_WATER) {
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(x + 2, y + (TILE_PX * 1) / 4, TILE_PX - 4, 2);
    ctx.fillRect(x + 2, y + (TILE_PX * 3) / 4, TILE_PX - 4, 2);
  } else if (t === T_BUSH) {
    ctx.fillStyle = "rgba(16,185,129,0.85)";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "rgba(6,95,70,0.9)";
    ctx.fillRect(x + 2, y + 4, 6, 6);
    ctx.fillRect(x + TILE_PX - 10, y + 6, 6, 6);
    ctx.fillRect(x + 6, y + TILE_PX - 10, 8, 6);
  } else if (t === T_EAGLE) {
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#92400e";
    // simple eagle silhouette
    ctx.fillRect(x + TILE_PX / 2 - 2, y + 4, 4, TILE_PX - 8);
    ctx.fillRect(x + 4, y + TILE_PX / 2 - 2, TILE_PX - 8, 4);
    ctx.fillRect(x + 6, y + 6, 4, 4);
    ctx.fillRect(x + TILE_PX - 10, y + 6, 4, 4);
  }
}

function drawTank(ctx: CanvasRenderingContext2D, t: Tank, body: string, dark: string) {
  const { x, y, dir } = t;
  const s = TANK_SIZE;
  // Treads
  ctx.fillStyle = dark;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = body;
  // Inset hull
  ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
  // Treads stripes
  ctx.fillStyle = dark;
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 1, y + 6 + i * 10, 3, 3);
    ctx.fillRect(x + s - 4, y + 6 + i * 10, 3, 3);
  }
  // Turret
  ctx.fillStyle = body;
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.fillRect(cx - 5, cy - 5, 10, 10);
  // Barrel
  ctx.fillStyle = dark;
  const bw = 4;
  const bl = s / 2 - 2;
  if (dir === "up") ctx.fillRect(cx - bw / 2, cy - bl, bw, bl);
  else if (dir === "down") ctx.fillRect(cx - bw / 2, cy, bw, bl);
  else if (dir === "left") ctx.fillRect(cx - bl, cy - bw / 2, bl, bw);
  else ctx.fillRect(cx, cy - bw / 2, bl, bw);
}
