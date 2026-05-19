import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";

// Battle-City-style 13×13 field. Two-tile tanks, NES feel.

const COLS = 13;
const ROWS = 13;
const TILE_PX = 28;
const FIELD_W = COLS * TILE_PX;
const FIELD_H = ROWS * TILE_PX;

const TANK_SIZE = 2 * TILE_PX;
const TANK_SPEED = 0.12; // px per ms
const BULLET_SPEED = 0.36;
const FIRE_COOLDOWN = 380;

const ENEMY_GOAL = 8;
const START_LIVES = 3;
const MAX_LIVE_ENEMIES = 3;

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
  aiTimer: number;
  spawnFlash: number; // ms remaining of "just spawned" flash
}

interface Bullet {
  x: number;
  y: number;
  dir: Dir;
  ownerEnemy: boolean;
  alive: boolean;
  trail: Array<{ x: number; y: number }>;
}

interface Explosion {
  x: number;
  y: number;
  age: number; // ms since start
  big: boolean;
}

interface GameState {
  field: Tile[][];
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  explosions: Explosion[];
  spawnTimer: number;
  spawnQueue: number;
  destroyed: number;
  lives: number;
  baseAlive: boolean;
  gameOver: boolean;
  victory: boolean;
  frame: number;
  time: number;
}

// 13×13 layout. Player spawns at (col 3, row 10), occupying cols 3-4, rows 10-11.
// Eagle at row 12 col 6, protected by bricks at (11, 5-7), (12, 5), (12, 7).
const LAYOUT: string[] = [
  ".............", //  0
  "..BB.....BB..", //  1
  "..BB.....BB..", //  2
  ".............", //  3
  "BBBB.....BBBB", //  4
  ".....SSS.....", //  5
  "X..X.....X..X", //  6  (bushes for cover)
  ".....SSS.....", //  7
  "BBBB.....BBBB", //  8
  ".............", //  9
  ".............", // 10  ← player spawn area (cols 3-4)
  ".....BBB.....", // 11
  ".....BEB.....", // 12
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
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T_STEEL;
  return field[r]![c]!;
}

function blocksTank(t: Tile): boolean {
  return t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_EAGLE;
}

function canTankOccupy(field: Tile[][], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + TANK_SIZE > FIELD_W || y + TANK_SIZE > FIELD_H) return false;
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

const PLAYER_SPAWN = { x: 3 * TILE_PX, y: 10 * TILE_PX };

function freshPlayer(): Tank {
  return {
    x: PLAYER_SPAWN.x,
    y: PLAYER_SPAWN.y,
    dir: "up",
    isEnemy: false,
    alive: true,
    cooldown: 0,
    aiTimer: 0,
    spawnFlash: 700,
  };
}

function freshState(): GameState {
  return {
    field: parseField(),
    player: freshPlayer(),
    enemies: [],
    bullets: [],
    explosions: [],
    spawnTimer: 500,
    spawnQueue: ENEMY_GOAL,
    destroyed: 0,
    lives: START_LIVES,
    baseAlive: true,
    gameOver: false,
    victory: false,
    frame: 0,
    time: 0,
  };
}

function spawnEnemy(s: GameState): boolean {
  const spots = [
    { x: 0, y: 0 },
    { x: (COLS / 2 - 1) * TILE_PX, y: 0 },
    { x: (COLS - 2) * TILE_PX, y: 0 },
  ];
  for (const spot of spots) {
    if (!canTankOccupy(s.field, spot.x, spot.y)) continue;
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
      cooldown: 700,
      aiTimer: 200 + Math.random() * 600,
      spawnFlash: 500,
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
    trail: [],
  });
  return true;
}

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
  const destroyedRef = useRef(0);
  const livesRef = useRef(START_LIVES);

  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [destroyed, setDestroyed] = useState(0);
  const [phase, setPhase] = useState<"intro" | "playing" | "over" | "won">("intro");
  const [, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("tanks-best");
  const sounds = useGameSounds();

  const start = useCallback(() => {
    stateRef.current = freshState();
    destroyedRef.current = 0;
    livesRef.current = START_LIVES;
    lastTimeRef.current = 0;
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
        case " ": case "Enter": case "k": case "K": case "x": case "X":
          inputRef.current.fire = true; e.preventDefault(); break;
      }
    };
    const up = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp": case "w": case "W": inputRef.current.up = false; break;
        case "ArrowDown": case "s": case "S": inputRef.current.down = false; break;
        case "ArrowLeft": case "a": case "A": inputRef.current.left = false; break;
        case "ArrowRight": case "d": case "D": inputRef.current.right = false; break;
        case " ": case "Enter": case "k": case "K": case "x": case "X":
          inputRef.current.fire = false; break;
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

  // Animation loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = lastTimeRef.current === 0 ? 16 : Math.min(40, now - lastTimeRef.current);
      lastTimeRef.current = now;
      const s = stateRef.current;
      s.frame++;
      s.time += dt;
      if (phase === "playing") step(s, dt);
      draw(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const step = useCallback(
    (s: GameState, dt: number) => {
      // Player movement
      if (s.player.alive) {
        s.player.spawnFlash = Math.max(0, s.player.spawnFlash - dt);
        s.player.cooldown = Math.max(0, s.player.cooldown - dt);
        const inp = inputRef.current;
        let newDir: Dir | null = null;
        if (inp.up) newDir = "up";
        else if (inp.down) newDir = "down";
        else if (inp.left) newDir = "left";
        else if (inp.right) newDir = "right";
        if (newDir) {
          // Snap to grid on perpendicular turn (NES Battle City feel)
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
        if (inp.fire && s.player.cooldown === 0) {
          if (fire(s.player, s)) sounds.playMove();
        }
      }

      // Enemy AI
      for (const e of s.enemies) {
        if (!e.alive) continue;
        e.spawnFlash = Math.max(0, e.spawnFlash - dt);
        e.cooldown = Math.max(0, e.cooldown - dt);
        if (e.spawnFlash > 0) continue; // can't move during spawn flash
        e.aiTimer -= dt;
        if (e.aiTimer <= 0) {
          const choices: Dir[] = ["up", "down", "left", "right"];
          if (Math.random() < 0.65) {
            // Bias toward player or base (whichever closer)
            const tx = Math.random() < 0.5 ? s.player.x : 5 * TILE_PX;
            const ty = Math.random() < 0.5 ? s.player.y : 12 * TILE_PX;
            const dx = tx - e.x;
            const dy = ty - e.y;
            if (Math.abs(dx) > Math.abs(dy)) {
              choices.unshift(dx > 0 ? "right" : "left");
            } else {
              choices.unshift(dy > 0 ? "down" : "up");
            }
          } else {
            for (let i = choices.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [choices[i], choices[j]] = [choices[j]!, choices[i]!];
            }
          }
          // Snap to grid on turn
          const next = choices[0]!;
          if (next !== e.dir) {
            if (next === "up" || next === "down") {
              e.x = Math.round(e.x / TILE_PX) * TILE_PX;
            } else {
              e.y = Math.round(e.y / TILE_PX) * TILE_PX;
            }
          }
          e.dir = next;
          e.aiTimer = 800 + Math.random() * 1400;
        }
        const v = DIR_VEC[e.dir];
        const moved = tryMove(s.field, e, v.dx * TANK_SPEED * 0.8 * dt, v.dy * TANK_SPEED * 0.8 * dt);
        if (!moved && e.aiTimer > 250) e.aiTimer = 120;
        if (e.cooldown === 0 && Math.random() < 0.015) fire(e, s);
      }

      // Spawning
      if (s.spawnQueue > 0) {
        s.spawnTimer -= dt;
        const alive = s.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
        if (s.spawnTimer <= 0 && alive < MAX_LIVE_ENEMIES) {
          if (spawnEnemy(s)) s.spawnQueue--;
          s.spawnTimer = 1500;
        }
      }

      // Bullets
      const liveBullets: Bullet[] = [];
      for (const b of s.bullets) {
        if (!b.alive) continue;
        const v = DIR_VEC[b.dir];
        // Sub-step bullets to prevent tunneling through walls
        const steps = 2;
        let hit: "wall" | "tank" | "edge" | null = null;
        for (let i = 0; i < steps && !hit; i++) {
          b.trail.push({ x: b.x + 2, y: b.y + 2 });
          if (b.trail.length > 4) b.trail.shift();
          b.x += (v.dx * BULLET_SPEED * dt) / steps;
          b.y += (v.dy * BULLET_SPEED * dt) / steps;
          const cx = b.x + 2;
          const cy = b.y + 2;
          if (cx < 0 || cx > FIELD_W || cy < 0 || cy > FIELD_H) { hit = "edge"; break; }
          const wall = damageWall(s, cx, cy);
          if (wall) {
            if (wall === "brick") {
              sounds.playMove();
              s.explosions.push({ x: cx, y: cy, age: 0, big: false });
            } else if (wall === "base") {
              sounds.playGameOver();
              s.explosions.push({ x: cx, y: cy, age: 0, big: true });
            }
            hit = "wall";
            break;
          }
          const bbox = { x: b.x, y: b.y, w: 4, h: 4 };
          if (!b.ownerEnemy) {
            for (const e of s.enemies) {
              if (!e.alive) continue;
              if (intersects(bbox, tankAabb(e))) {
                e.alive = false;
                s.destroyed++;
                s.explosions.push({ x: e.x + TANK_SIZE / 2, y: e.y + TANK_SIZE / 2, age: 0, big: true });
                hit = "tank";
                sounds.playError();
                break;
              }
            }
          } else if (s.player.alive && s.player.spawnFlash === 0 && intersects(bbox, tankAabb(s.player))) {
            s.player.alive = false;
            s.explosions.push({ x: s.player.x + TANK_SIZE / 2, y: s.player.y + TANK_SIZE / 2, age: 0, big: true });
            hit = "tank";
            sounds.playError();
          }
        }
        if (!hit) liveBullets.push(b);
      }
      s.bullets = liveBullets;

      // Explosions age
      const liveExplosions: Explosion[] = [];
      for (const e of s.explosions) {
        e.age += dt;
        if (e.age < (e.big ? 350 : 200)) liveExplosions.push(e);
      }
      s.explosions = liveExplosions;

      // Cull dead enemies
      s.enemies = s.enemies.filter((e) => e.alive);

      // Player respawn / lives / win / lose
      if (!s.player.alive && !s.gameOver) {
        if (s.lives > 1) {
          s.lives--;
          s.player = freshPlayer();
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

      // Sync React state minimally
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
    },
    [phase, sounds, updateHighScore],
  );

  const draw = useCallback((s: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Background
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    // Subtle grid for arcade feel
    ctx.strokeStyle = "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * TILE_PX + 0.5, 0);
      ctx.lineTo(i * TILE_PX + 0.5, FIELD_H);
      ctx.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * TILE_PX + 0.5);
      ctx.lineTo(FIELD_W, j * TILE_PX + 0.5);
      ctx.stroke();
    }

    // Tiles under tanks (skip bushes — bushes go on top)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = s.field[r]![c]!;
        if (t === T_EMPTY || t === T_BUSH) continue;
        drawTile(ctx, c * TILE_PX, r * TILE_PX, t, s.time);
      }
    }

    // Bullet trails first
    for (const b of s.bullets) {
      ctx.fillStyle = "rgba(254,243,199,0.4)";
      for (const p of b.trail) ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    }

    // Bullets
    for (const b of s.bullets) {
      ctx.fillStyle = "#fef3c7";
      ctx.fillRect(b.x, b.y, 4, 4);
    }

    // Tanks
    if (s.player.alive) drawTank(ctx, s.player, "#facc15", "#7c2d12", s.frame);
    for (const e of s.enemies) {
      if (!e.alive) continue;
      drawTank(ctx, e, "#cbd5e1", "#1e293b", s.frame);
    }

    // Bushes on top (cover)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (s.field[r]![c] === T_BUSH) drawTile(ctx, c * TILE_PX, r * TILE_PX, T_BUSH, s.time);
      }
    }

    // Explosions on top of everything
    for (const ex of s.explosions) drawExplosion(ctx, ex);
  }, []);

  // Touch controls
  const setInput = (key: keyof typeof inputRef.current, v: boolean) => {
    inputRef.current[key] = v;
    if (key !== "fire" && v) {
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
              <p>Defend the eagle and destroy {ENEMY_GOAL} enemy tanks.</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Controls</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Desktop: arrows (or WASD) to move, Space / Enter / X / K to fire</li>
                <li>Mobile: D-pad + Fire button below the field</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Rules</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>3 lives. Lose all = game over.</li>
                <li>If the eagle is hit you lose instantly — keep its brick ring intact.</li>
                <li>Brick walls crumble. Steel walls don't.</li>
                <li>Bushes hide tanks (cover for both sides).</li>
                <li>Survive bonus +500 for clearing all enemies with the base intact.</li>
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
              border: "2px solid #1f2937",
              borderRadius: "0.25rem",
              maxWidth: "100%",
              maxHeight: "100%",
              touchAction: "none",
              boxShadow: "0 0 0 1px #facc15 inset, 0 4px 24px rgba(0,0,0,0.4)",
            }}
          />
          {phase === "intro" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#facc15" }}>
                Defend the eagle
              </div>
              <div style={{ color: "var(--paper)", fontSize: "0.85rem", textAlign: "center", maxWidth: "16rem" }}>
                Arrows / WASD to move · Space / X to fire
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
              boxShadow: "0 4px 0 rgba(0,0,0,0.25)",
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
        background: "rgba(10,10,10,0.82)",
        borderRadius: "0.25rem",
      }}
    >
      {children}
    </div>
  );
}

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, t: Tile, time: number) {
  if (t === T_BRICK) {
    // Two rows of bricks per tile, staggered. Mortar lines visible.
    ctx.fillStyle = "#5b1d0e";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#c0411b";
    const half = TILE_PX / 2;
    const w = TILE_PX / 2;
    // Top row
    ctx.fillRect(x + 1, y + 1, w - 2, half - 2);
    ctx.fillRect(x + half + 1, y + 1, w - 2, half - 2);
    // Bottom row (staggered by quarter)
    ctx.fillRect(x + 1, y + half + 1, w / 2 - 2, half - 2);
    ctx.fillRect(x + w / 2 + 1, y + half + 1, w - 2, half - 2);
    ctx.fillRect(x + half + w / 2 + 1, y + half + 1, w / 2 - 2, half - 2);
    // Highlight
    ctx.fillStyle = "rgba(254,215,170,0.25)";
    ctx.fillRect(x + 2, y + 2, 4, 1);
    ctx.fillRect(x + half + 2, y + 2, 4, 1);
  } else if (t === T_STEEL) {
    // Brushed-metal cross
    ctx.fillStyle = "#475569";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(x + 3, y + 3, TILE_PX - 6, TILE_PX - 6);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(x + 5, y + 5, TILE_PX - 14, 2);
    ctx.fillRect(x + 5, y + 5, 2, TILE_PX - 14);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(x + TILE_PX / 2 - 1, y + 2, 2, TILE_PX - 4);
    ctx.fillRect(x + 2, y + TILE_PX / 2 - 1, TILE_PX - 4, 2);
  } else if (t === T_WATER) {
    // Animated ripples
    ctx.fillStyle = "#1e3a8a";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    const phase = Math.floor(time / 250) % 2;
    ctx.fillStyle = "#3b82f6";
    const o = phase === 0 ? 0 : 4;
    ctx.fillRect(x + 2 + o, y + 6, 6, 2);
    ctx.fillRect(x + TILE_PX - 12 + o, y + 14, 6, 2);
    ctx.fillRect(x + 2 + o, y + 22, 6, 2);
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(x + 6, y + 10, 4, 1);
    ctx.fillRect(x + TILE_PX - 14, y + 18, 4, 1);
  } else if (t === T_BUSH) {
    ctx.fillStyle = "#064e3b";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#10b981";
    ctx.fillRect(x + 2, y + 4, 5, 5);
    ctx.fillRect(x + 10, y + 2, 6, 6);
    ctx.fillRect(x + TILE_PX - 9, y + 6, 6, 5);
    ctx.fillRect(x + 4, y + 12, 7, 5);
    ctx.fillRect(x + 13, y + 14, 6, 6);
    ctx.fillRect(x + TILE_PX - 11, y + 16, 6, 5);
    ctx.fillRect(x + 2, y + 20, 6, 5);
    ctx.fillRect(x + 10, y + 22, 5, 5);
    ctx.fillStyle = "#34d399";
    ctx.fillRect(x + 4, y + 6, 2, 2);
    ctx.fillRect(x + 12, y + 4, 2, 2);
    ctx.fillRect(x + 15, y + 16, 2, 2);
    ctx.fillRect(x + 6, y + 22, 2, 2);
  } else if (t === T_EAGLE) {
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#fef3c7";
    // Eagle silhouette — chunky pixel art
    // Head
    ctx.fillRect(x + 11, y + 4, 6, 4);
    // Beak
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x + 13, y + 8, 2, 3);
    // Eyes
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(x + 12, y + 5, 1, 2);
    ctx.fillRect(x + 15, y + 5, 1, 2);
    // Body + wings
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(x + 9, y + 11, 10, 6);
    ctx.fillRect(x + 5, y + 13, 4, 8);
    ctx.fillRect(x + 19, y + 13, 4, 8);
    ctx.fillRect(x + 3, y + 16, 3, 6);
    ctx.fillRect(x + 22, y + 16, 3, 6);
    // Tail
    ctx.fillRect(x + 10, y + 17, 8, 6);
    // Wing details
    ctx.fillStyle = "#d97706";
    ctx.fillRect(x + 6, y + 14, 2, 1);
    ctx.fillRect(x + 20, y + 14, 2, 1);
    ctx.fillRect(x + 11, y + 18, 6, 1);
  }
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  t: Tank,
  body: string,
  dark: string,
  frame: number,
) {
  const { x, y, dir } = t;
  const s = TANK_SIZE;

  // Spawn flash — strobe before becoming solid
  if (t.spawnFlash > 0) {
    const on = Math.floor(t.spawnFlash / 80) % 2 === 0;
    ctx.fillStyle = on ? "rgba(250,204,21,0.55)" : "rgba(96,165,250,0.45)";
    ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
    return;
  }

  const treadFrame = Math.floor(frame / 4) % 2;

  // Tread strips (left + right)
  ctx.fillStyle = dark;
  ctx.fillRect(x + 2, y + 4, 8, s - 8);
  ctx.fillRect(x + s - 10, y + 4, 8, s - 8);
  // Tread cleats
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  for (let i = 0; i < 5; i++) {
    const cy = y + 6 + i * 9 + treadFrame * 2;
    ctx.fillRect(x + 3, cy, 6, 2);
    ctx.fillRect(x + s - 9, cy, 6, 2);
  }

  // Hull
  ctx.fillStyle = body;
  ctx.fillRect(x + 10, y + 6, s - 20, s - 12);
  // Hull shading
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(x + 10, y + s - 8, s - 20, 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x + 10, y + 6, s - 20, 2);

  // Turret
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.fillStyle = body;
  ctx.fillRect(cx - 7, cy - 7, 14, 14);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(cx - 7, cy + 5, 14, 2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(cx - 7, cy - 7, 14, 2);

  // Barrel
  ctx.fillStyle = dark;
  const bw = 4;
  const bl = s / 2 + 2;
  if (dir === "up") ctx.fillRect(cx - bw / 2, cy - bl, bw, bl);
  else if (dir === "down") ctx.fillRect(cx - bw / 2, cy, bw, bl);
  else if (dir === "left") ctx.fillRect(cx - bl, cy - bw / 2, bl, bw);
  else ctx.fillRect(cx, cy - bw / 2, bl, bw);

  // Hatch dot on turret (visible direction marker)
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
}

function drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion) {
  const maxAge = e.big ? 350 : 200;
  const tt = e.age / maxAge;
  const radius = e.big ? 16 : 8;
  const r = radius * (0.4 + tt * 0.8);
  // Outer flash
  ctx.fillStyle = tt < 0.4 ? "#fef3c7" : "rgba(254,243,199,0.6)";
  ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
  // Inner core
  ctx.fillStyle = tt < 0.5 ? "#f59e0b" : "#dc2626";
  const ir = r * 0.6;
  ctx.fillRect(e.x - ir, e.y - ir, ir * 2, ir * 2);
  // Sparks
  if (e.big && tt < 0.6) {
    ctx.fillStyle = "#fef3c7";
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + tt * 3;
      const dist = r * 1.4;
      const sx = e.x + Math.cos(angle) * dist;
      const sy = e.y + Math.sin(angle) * dist;
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }
}
