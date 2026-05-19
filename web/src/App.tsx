import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";

// Battle-City-style 13×13 field. NES feel.

const COLS = 13;
const ROWS = 13;
const TILE_PX = 28;
const FIELD_W = COLS * TILE_PX;
const FIELD_H = ROWS * TILE_PX;

const TANK_SIZE = 2 * TILE_PX;
const PLAYER_SPEED = 0.12; // px per ms
const BULLET_SPEED = 0.36;
const FIRE_COOLDOWN = 380;

const STAGE_BONUS = 500;
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

type EnemyKind = "basic" | "fast" | "armor";
const ENEMY_SPEED: Record<EnemyKind, number> = { basic: 0.075, fast: 0.13, armor: 0.06 };
const ENEMY_POINTS: Record<EnemyKind, number> = { basic: 100, fast: 200, armor: 400 };
const ENEMY_HP: Record<EnemyKind, number> = { basic: 1, fast: 1, armor: 3 };

interface Tank {
  x: number;
  y: number;
  dir: Dir;
  isEnemy: boolean;
  kind: EnemyKind | "player";
  hp: number;
  alive: boolean;
  cooldown: number;
  aiTimer: number;
  spawnFlash: number;
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
  age: number;
  big: boolean;
}

interface GameState {
  field: Tile[][];
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  explosions: Explosion[];
  stage: number; // 1-indexed
  spawnQueue: EnemyKind[]; // enemies left to spawn this stage
  spawnTimer: number;
  killsByKind: Record<EnemyKind, number>;
  killsThisStage: number;
  totalScore: number; // carries across stages
  lives: number;
  baseAlive: boolean;
  stageCleared: boolean;
  gameOver: boolean;
  frame: number;
  time: number;
}

// ──────────── LEVELS ────────────
// Each level is a 13-row × 13-col layout. Player spawns at (col 3, row 10),
// occupying cols 3-4 / rows 10-11. Enemies spawn at three top-of-field 2×2
// patches: (cols 0-1, rows 0-1), (cols 5-6, rows 0-1), (cols 11-12, rows 0-1).
// All four 2×2 spawn patches MUST be empty in every layout.
// Eagle (E) is at (row 12, col 6); protective bricks at (11, 5-7), (12, 5+7).
//
// B = brick (destructible) · S = steel · W = water · X = bush (cover)

const LEVEL_1: string[] = [
  ".............",
  "..BB.....BB..",
  "..BB.....BB..",
  ".............",
  "BBBB.....BBBB",
  ".....SSS.....",
  "X..X.....X..X",
  ".....SSS.....",
  "BBBB.....BBBB",
  ".............",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

const LEVEL_2: string[] = [
  ".............",
  "..BB.....BB..",
  "..BB.....BB..",
  "B...........B",
  "B.B.B.B.B.B.B",
  ".............",
  ".B...X.X...B.",
  ".S.S.S.S.S.S.",
  ".............",
  "B.B.B.B.B.B.B",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

const LEVEL_3: string[] = [
  ".............",
  "..BB.....BB..",
  "..BB.....BB..",
  ".............",
  ".SSSS...SSSS.",
  ".S.........S.",
  ".S..XXXXX..S.",
  ".S.........S.",
  ".SSSS...SSSS.",
  ".............",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

const LEVELS: string[][] = [LEVEL_1, LEVEL_2, LEVEL_3];

// Enemy compositions per stage (left → right = first spawn → last)
const STAGE_ENEMIES: EnemyKind[][] = [
  ["basic", "basic", "basic", "basic", "basic", "basic", "basic", "basic"],
  ["basic", "basic", "fast", "basic", "fast", "basic", "fast", "fast", "basic", "fast"],
  ["fast", "basic", "armor", "fast", "armor", "fast", "armor", "fast", "armor", "armor", "fast", "armor"],
];

function parseField(stage: number): Tile[][] {
  const layout = LEVELS[Math.min(stage - 1, LEVELS.length - 1)] ?? LEVEL_1;
  const f: Tile[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Tile[] = [];
    const line = layout[r] ?? "";
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

function tankAabb(t: Tank) {
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
    kind: "player",
    hp: 1,
    alive: true,
    cooldown: 0,
    aiTimer: 0,
    spawnFlash: 700,
  };
}

function freshStateForStage(stage: number, carryLives: number, carryScore: number): GameState {
  const queue = STAGE_ENEMIES[Math.min(stage - 1, STAGE_ENEMIES.length - 1)] ?? STAGE_ENEMIES[0]!;
  return {
    field: parseField(stage),
    player: freshPlayer(),
    enemies: [],
    bullets: [],
    explosions: [],
    stage,
    spawnQueue: queue.slice(),
    spawnTimer: 600,
    killsByKind: { basic: 0, fast: 0, armor: 0 },
    killsThisStage: 0,
    totalScore: carryScore,
    lives: carryLives,
    baseAlive: true,
    stageCleared: false,
    gameOver: false,
    frame: 0,
    time: 0,
  };
}

function spawnEnemy(s: GameState): boolean {
  const kind = s.spawnQueue[0];
  if (!kind) return false;
  const spots = [
    { x: 0, y: 0 },
    { x: (COLS / 2 - 1) * TILE_PX, y: 0 },
    { x: (COLS - 2) * TILE_PX, y: 0 },
  ];
  // Pick a spot that isn't overlapping
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
      kind,
      hp: ENEMY_HP[kind],
      alive: true,
      cooldown: 700,
      aiTimer: 200 + Math.random() * 600,
      spawnFlash: 500,
    });
    s.spawnQueue.shift();
    return true;
  }
  return false;
}

function tryMove(
  field: Tile[][],
  t: Tank,
  dx: number,
  dy: number,
  others: ReadonlyArray<Tank>,
): boolean {
  const nx = t.x + dx;
  const ny = t.y + dy;
  if (!canTankOccupy(field, nx, ny)) return false;
  // Tank-vs-tank blocking — no ghosting through other live tanks.
  const newBox = { x: nx, y: ny, w: TANK_SIZE, h: TANK_SIZE };
  for (const o of others) {
    if (o === t || !o.alive) continue;
    if (intersects(newBox, tankAabb(o))) return false;
  }
  t.x = nx;
  t.y = ny;
  return true;
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

// Check the bullet's full 4×4 box vs the tile grid. Smash every brick the
// box overlaps in one shot (perpendicular shots take out two bricks).
function damageBullet(s: GameState, b: Bullet): "brick" | "steel" | "base" | null {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [b.x, b.y],
    [b.x + 3, b.y],
    [b.x, b.y + 3],
    [b.x + 3, b.y + 3],
  ];
  let result: "brick" | "steel" | "base" | null = null;
  const bricks: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const [px, py] of pts) {
    const c = Math.floor(px / TILE_PX);
    const r = Math.floor(py / TILE_PX);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const key = `${r},${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = s.field[r]![c]!;
    if (t === T_BRICK) {
      bricks.push([r, c]);
      if (!result) result = "brick";
    } else if (t === T_STEEL) {
      if (result !== "base") result = "steel";
    } else if (t === T_EAGLE) {
      s.baseAlive = false;
      s.gameOver = true;
      result = "base";
    }
  }
  if (bricks.length > 0) for (const [r, c] of bricks) s.field[r]![c] = T_EMPTY;
  return result;
}

// ──────────── React component ────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshStateForStage(1, START_LIVES, 0));
  const inputRef = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean }>(
    { up: false, down: false, left: false, right: false, fire: false },
  );
  const lastTimeRef = useRef(0);
  const killsRef = useRef(0);
  const livesRef = useRef(START_LIVES);
  const scoreRef = useRef(0);
  const stageRef = useRef(1);
  const phaseRef = useRef<Phase>("intro");

  const [stage, setStage] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [kills, setKills] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [stageClearSummary, setStageClearSummary] = useState<StageSummary | null>(null);
  const [, force] = useState(0);
  const [bestScore, updateHighScore] = useHighScore("tanks-best");
  const [bestStage, updateBestStage] = useHighScore("tanks-best-stage");
  const sounds = useGameSounds();

  phaseRef.current = phase;

  const startNewGame = useCallback(() => {
    stateRef.current = freshStateForStage(1, START_LIVES, 0);
    killsRef.current = 0;
    livesRef.current = START_LIVES;
    scoreRef.current = 0;
    stageRef.current = 1;
    lastTimeRef.current = 0;
    setStage(1);
    setScore(0);
    setLives(START_LIVES);
    setKills(0);
    setStageClearSummary(null);
    setPhase("stage-intro");
    force((x) => x + 1);
  }, []);

  const advanceToNextStage = useCallback(() => {
    const cur = stateRef.current;
    const nextStage = cur.stage + 1;
    if (nextStage > LEVELS.length) {
      setPhase("won");
      sounds.playLevelUp();
      return;
    }
    stateRef.current = freshStateForStage(nextStage, cur.lives, cur.totalScore);
    killsRef.current = 0;
    stageRef.current = nextStage;
    lastTimeRef.current = 0;
    setStage(nextStage);
    setKills(0);
    setStageClearSummary(null);
    setPhase("stage-intro");
  }, [sounds]);

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

  // Auto-advance "stage-intro" → "playing" after 1.8s
  useEffect(() => {
    if (phase !== "stage-intro") return;
    const t = setTimeout(() => setPhase("playing"), 1800);
    return () => clearTimeout(t);
  }, [phase]);

  // Animation loop
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const dt = lastTimeRef.current === 0 ? 16 : Math.min(40, now - lastTimeRef.current);
      lastTimeRef.current = now;
      const s = stateRef.current;
      s.frame++;
      s.time += dt;
      if (phaseRef.current === "playing") step(s, dt);
      draw(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          if (newDir !== s.player.dir) {
            if (newDir === "up" || newDir === "down") {
              s.player.x = Math.round(s.player.x / TILE_PX) * TILE_PX;
            } else {
              s.player.y = Math.round(s.player.y / TILE_PX) * TILE_PX;
            }
          }
          s.player.dir = newDir;
          const v = DIR_VEC[newDir];
          tryMove(s.field, s.player, v.dx * PLAYER_SPEED * dt, v.dy * PLAYER_SPEED * dt, s.enemies);
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
        if (e.spawnFlash > 0) continue;
        e.aiTimer -= dt;
        if (e.aiTimer <= 0) {
          const choices: Dir[] = ["up", "down", "left", "right"];
          if (Math.random() < 0.65) {
            const tx = Math.random() < 0.5 ? s.player.x : 5 * TILE_PX;
            const ty = Math.random() < 0.5 ? s.player.y : 12 * TILE_PX;
            const dx = tx - e.x;
            const dy = ty - e.y;
            if (Math.abs(dx) > Math.abs(dy)) choices.unshift(dx > 0 ? "right" : "left");
            else choices.unshift(dy > 0 ? "down" : "up");
          } else {
            for (let i = choices.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [choices[i], choices[j]] = [choices[j]!, choices[i]!];
            }
          }
          const next = choices[0]!;
          if (next !== e.dir) {
            if (next === "up" || next === "down") e.x = Math.round(e.x / TILE_PX) * TILE_PX;
            else e.y = Math.round(e.y / TILE_PX) * TILE_PX;
          }
          e.dir = next;
          e.aiTimer = 800 + Math.random() * 1400;
        }
        const v = DIR_VEC[e.dir];
        const speed = e.kind === "player" ? PLAYER_SPEED : ENEMY_SPEED[e.kind as EnemyKind];
        // Enemies are blocked by all other live tanks (other enemies + the player).
        const blockers: Tank[] = [s.player, ...s.enemies];
        const moved = tryMove(s.field, e, v.dx * speed * dt, v.dy * speed * dt, blockers);
        if (!moved && e.aiTimer > 250) e.aiTimer = 120;
        if (e.cooldown === 0 && Math.random() < 0.015) fire(e, s);
      }

      // Spawning
      if (s.spawnQueue.length > 0) {
        s.spawnTimer -= dt;
        const alive = s.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
        if (s.spawnTimer <= 0 && alive < MAX_LIVE_ENEMIES) {
          if (spawnEnemy(s)) {
            s.spawnTimer = 1500;
          } else {
            s.spawnTimer = 300;
          }
        }
      }

      // Bullets
      const liveBullets: Bullet[] = [];
      for (const b of s.bullets) {
        if (!b.alive) continue;
        const v = DIR_VEC[b.dir];
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
          const wall = damageBullet(s, b);
          if (wall) {
            if (wall === "brick") {
              sounds.playMove();
              s.explosions.push({ x: cx, y: cy, age: 0, big: false });
            } else if (wall === "steel") {
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
                e.hp -= 1;
                if (e.hp <= 0) {
                  e.alive = false;
                  s.killsThisStage++;
                  const kind = e.kind as EnemyKind;
                  s.killsByKind[kind]++;
                  s.totalScore += ENEMY_POINTS[kind];
                  s.explosions.push({ x: e.x + TANK_SIZE / 2, y: e.y + TANK_SIZE / 2, age: 0, big: true });
                  sounds.playError();
                } else {
                  s.explosions.push({ x: e.x + TANK_SIZE / 2, y: e.y + TANK_SIZE / 2, age: 0, big: false });
                }
                hit = "tank";
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

      // Age explosions
      const liveExplosions: Explosion[] = [];
      for (const e of s.explosions) {
        e.age += dt;
        if (e.age < (e.big ? 350 : 200)) liveExplosions.push(e);
      }
      s.explosions = liveExplosions;

      s.enemies = s.enemies.filter((e) => e.alive);

      // Player respawn / lives / win / lose
      if (!s.player.alive && !s.gameOver && !s.stageCleared) {
        if (s.lives > 1) {
          s.lives--;
          s.player = freshPlayer();
        } else {
          s.lives = 0;
          s.gameOver = true;
        }
      }
      if (!s.baseAlive) s.gameOver = true;

      // Stage clear: all queued enemies spawned AND none alive AND player alive AND base intact
      if (
        !s.gameOver &&
        !s.stageCleared &&
        s.spawnQueue.length === 0 &&
        s.enemies.length === 0 &&
        s.player.alive &&
        s.baseAlive
      ) {
        s.stageCleared = true;
        s.totalScore += STAGE_BONUS;
      }

      // Sync React state minimally
      if (s.killsThisStage !== killsRef.current) {
        killsRef.current = s.killsThisStage;
        setKills(s.killsThisStage);
      }
      if (s.lives !== livesRef.current) {
        livesRef.current = s.lives;
        setLives(s.lives);
      }
      if (s.totalScore !== scoreRef.current) {
        scoreRef.current = s.totalScore;
        setScore(s.totalScore);
      }

      // Phase transitions
      if (s.stageCleared && phaseRef.current === "playing") {
        const summary: StageSummary = {
          stage: s.stage,
          killsByKind: { ...s.killsByKind },
          totalKills: s.killsThisStage,
          bonus: STAGE_BONUS,
          score: s.totalScore,
        };
        setStageClearSummary(summary);
        setPhase("stage-clear");
        sounds.playLevelUp();
      }
      if (s.gameOver && phaseRef.current === "playing") {
        updateHighScore(s.totalScore);
        updateBestStage(s.stage);
        setPhase("over");
        sounds.playGameOver();
      }
    },
    [sounds, updateHighScore, updateBestStage],
  );

  const draw = useCallback((s: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    // Subtle grid
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

    // Bullet trails
    for (const b of s.bullets) {
      ctx.fillStyle = "rgba(254,243,199,0.35)";
      for (const p of b.trail) ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    }
    // Bullets
    for (const b of s.bullets) {
      ctx.fillStyle = b.ownerEnemy ? "#fef3c7" : "#fef9c3";
      ctx.fillRect(b.x, b.y, 4, 4);
    }

    // Tanks
    if (s.player.alive) drawTank(ctx, s.player, s.frame);
    for (const e of s.enemies) if (e.alive) drawTank(ctx, e, s.frame);

    // Bushes on top
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (s.field[r]![c] === T_BUSH) drawTile(ctx, c * TILE_PX, r * TILE_PX, T_BUSH, s.time);
      }
    }

    // Explosions
    for (const ex of s.explosions) drawExplosion(ctx, ex);
  }, []);

  // Touch input
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

  // Enemy queue strip — small tank icons representing remaining un-spawned enemies
  const queue = stateRef.current.spawnQueue;

  return (
    <GameShell
      topbar={
        <GameTopbar
          title={`Tanks · Stage ${stage}`}
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Lives", value: lives },
            { label: "Kills", value: kills },
            { label: "Best", value: bestScore },
            { label: "Top St.", value: bestStage },
          ]}
          rules={
            <div>
              <h3 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>Tanks</h3>
              <p>Defend the eagle and clear all enemy tanks. {LEVELS.length} stages of increasing difficulty.</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Controls</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Desktop: arrows (or WASD) to move, Space / Enter / X / K to fire</li>
                <li>Mobile: D-pad + Fire button below the field</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Enemy types</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li><strong>Basic</strong> (silver) — 100 pts, 1 hit</li>
                <li><strong>Fast</strong> (white) — 200 pts, 1 hit, but quick</li>
                <li><strong>Armor</strong> (gold-trim) — 400 pts, takes 3 hits</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Rules</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>3 lives across all stages. Lose all = game over.</li>
                <li>If the eagle is hit you lose instantly — keep its brick ring intact.</li>
                <li>Brick walls crumble. Steel walls don't. Bushes hide tanks.</li>
                <li>Survive bonus +{STAGE_BONUS} per stage cleared with base intact.</li>
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
          gap: "0.4rem",
          overflow: "hidden",
        }}
      >
        {/* Enemy queue strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            width: "100%",
            maxWidth: `${FIELD_W * 2}px`,
            padding: "0.25rem 0.5rem",
          }}
        >
          <span
            style={{
              fontFamily: "Fraunces, serif",
              fontWeight: 700,
              fontSize: "0.75rem",
              color: "var(--muted)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Queue
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", flex: 1 }}>
            {queue.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>—</span>
            ) : (
              queue.map((k, i) => (
                <QueueIcon key={i} kind={k} />
              ))
            )}
          </div>
        </div>

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
              background: "#000",
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
                TANKS
              </div>
              <div style={{ color: "var(--paper)", fontSize: "0.85rem", textAlign: "center", maxWidth: "18rem" }}>
                Defend the eagle across {LEVELS.length} stages.<br />
                Arrows / WASD to move · Space / X to fire
              </div>
              <GameButton size="md" variant="primary" onClick={startNewGame}>Start</GameButton>
            </Overlay>
          )}
          {phase === "stage-intro" && (
            <Overlay>
              <div
                style={{
                  fontFamily: "Fraunces, serif",
                  fontWeight: 800,
                  fontSize: "2rem",
                  color: "#facc15",
                  letterSpacing: "0.15em",
                }}
              >
                STAGE {stage}
              </div>
              <div style={{ color: "var(--paper)", fontSize: "0.85rem" }}>
                {STAGE_ENEMIES[stage - 1]?.length ?? 0} enemy tanks · {lives} lives
              </div>
            </Overlay>
          )}
          {phase === "stage-clear" && stageClearSummary && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#10b981" }}>
                STAGE {stageClearSummary.stage} CLEAR
              </div>
              <div style={{ color: "var(--paper)", fontSize: "0.85rem", display: "grid", gridTemplateColumns: "auto auto", gap: "0.2rem 1rem", textAlign: "left" }}>
                <span>Basic ×{stageClearSummary.killsByKind.basic}</span>
                <span>{stageClearSummary.killsByKind.basic * ENEMY_POINTS.basic} pts</span>
                <span>Fast ×{stageClearSummary.killsByKind.fast}</span>
                <span>{stageClearSummary.killsByKind.fast * ENEMY_POINTS.fast} pts</span>
                <span>Armor ×{stageClearSummary.killsByKind.armor}</span>
                <span>{stageClearSummary.killsByKind.armor * ENEMY_POINTS.armor} pts</span>
                <span style={{ color: "#facc15" }}>Survive bonus</span>
                <span style={{ color: "#facc15" }}>+{stageClearSummary.bonus}</span>
                <span style={{ color: "#facc15", fontWeight: 700 }}>Total</span>
                <span style={{ color: "#facc15", fontWeight: 700 }}>{stageClearSummary.score}</span>
              </div>
              <GameButton size="md" variant="primary" onClick={advanceToNextStage}>
                {stage >= LEVELS.length ? "Finish" : "Next Stage"}
              </GameButton>
            </Overlay>
          )}
          {phase === "over" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#ef4444" }}>
                GAME OVER
              </div>
              <div style={{ color: "#f8fafc" }}>Reached Stage {stage}</div>
              <div style={{ color: "#f8fafc" }}>Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={startNewGame}>Try Again</GameButton>
            </Overlay>
          )}
          {phase === "won" && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#10b981" }}>
                ALL STAGES CLEAR
              </div>
              <div style={{ color: "#f8fafc" }}>Final Score: {score}</div>
              <GameButton size="md" variant="primary" onClick={startNewGame}>Play Again</GameButton>
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

type Phase = "intro" | "stage-intro" | "playing" | "stage-clear" | "over" | "won";

interface StageSummary {
  stage: number;
  killsByKind: Record<EnemyKind, number>;
  totalKills: number;
  bonus: number;
  score: number;
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
        background: "rgba(0,0,0,0.88)",
        borderRadius: "0.25rem",
      }}
    >
      {children}
    </div>
  );
}

function QueueIcon({ kind }: { kind: EnemyKind }) {
  const color =
    kind === "armor" ? "#fbbf24" :
    kind === "fast" ? "#e2e8f0" :
    "#94a3b8";
  return (
    <span
      title={kind}
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        background: color,
        border: "1px solid rgba(0,0,0,0.6)",
        borderRadius: 2,
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.35), inset 0 2px 0 rgba(255,255,255,0.25)",
      }}
    />
  );
}

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, t: Tile, time: number) {
  if (t === T_BRICK) {
    ctx.fillStyle = "#5b1d0e";
    ctx.fillRect(x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#c0411b";
    const half = TILE_PX / 2;
    const w = TILE_PX / 2;
    ctx.fillRect(x + 1, y + 1, w - 2, half - 2);
    ctx.fillRect(x + half + 1, y + 1, w - 2, half - 2);
    ctx.fillRect(x + 1, y + half + 1, w / 2 - 2, half - 2);
    ctx.fillRect(x + w / 2 + 1, y + half + 1, w - 2, half - 2);
    ctx.fillRect(x + half + w / 2 + 1, y + half + 1, w / 2 - 2, half - 2);
    ctx.fillStyle = "rgba(254,215,170,0.25)";
    ctx.fillRect(x + 2, y + 2, 4, 1);
    ctx.fillRect(x + half + 2, y + 2, 4, 1);
  } else if (t === T_STEEL) {
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
    ctx.fillRect(x + 11, y + 4, 6, 4);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x + 13, y + 8, 2, 3);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(x + 12, y + 5, 1, 2);
    ctx.fillRect(x + 15, y + 5, 1, 2);
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(x + 9, y + 11, 10, 6);
    ctx.fillRect(x + 5, y + 13, 4, 8);
    ctx.fillRect(x + 19, y + 13, 4, 8);
    ctx.fillRect(x + 3, y + 16, 3, 6);
    ctx.fillRect(x + 22, y + 16, 3, 6);
    ctx.fillRect(x + 10, y + 17, 8, 6);
    ctx.fillStyle = "#d97706";
    ctx.fillRect(x + 6, y + 14, 2, 1);
    ctx.fillRect(x + 20, y + 14, 2, 1);
    ctx.fillRect(x + 11, y + 18, 6, 1);
  }
}

function drawTank(ctx: CanvasRenderingContext2D, t: Tank, frame: number) {
  const { x, y, dir } = t;
  const s = TANK_SIZE;

  // Spawn flash
  if (t.spawnFlash > 0) {
    const on = Math.floor(t.spawnFlash / 80) % 2 === 0;
    ctx.fillStyle = on ? "rgba(250,204,21,0.55)" : "rgba(96,165,250,0.45)";
    ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
    return;
  }

  // Colors by kind
  const body = t.kind === "player" ? "#facc15"
    : t.kind === "fast" ? "#e2e8f0"
    : t.kind === "armor" ? "#fbbf24"
    : "#94a3b8";
  const dark = t.kind === "player" ? "#7c2d12"
    : t.kind === "fast" ? "#475569"
    : t.kind === "armor" ? "#7c2d12"
    : "#1e293b";

  const treadFrame = Math.floor(frame / 4) % 2;

  // Treads
  ctx.fillStyle = dark;
  ctx.fillRect(x + 2, y + 4, 8, s - 8);
  ctx.fillRect(x + s - 10, y + 4, 8, s - 8);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  for (let i = 0; i < 5; i++) {
    const cy = y + 6 + i * 9 + treadFrame * 2;
    ctx.fillRect(x + 3, cy, 6, 2);
    ctx.fillRect(x + s - 9, cy, 6, 2);
  }

  // Hull
  ctx.fillStyle = body;
  ctx.fillRect(x + 10, y + 6, s - 20, s - 12);
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

  // Armor accent — gold rivets
  if (t.kind === "armor") {
    ctx.fillStyle = "#7c2d12";
    ctx.fillRect(cx - 4, cy - 4, 2, 2);
    ctx.fillRect(cx + 2, cy - 4, 2, 2);
    ctx.fillRect(cx - 4, cy + 2, 2, 2);
    ctx.fillRect(cx + 2, cy + 2, 2, 2);
  }

  // HP indicator for multi-hit tanks
  if (t.hp > 1) {
    ctx.fillStyle = "#ef4444";
    for (let i = 0; i < t.hp; i++) {
      ctx.fillRect(x + 4 + i * 4, y + 2, 3, 2);
    }
  }

  // Barrel
  ctx.fillStyle = dark;
  const bw = 4;
  const bl = s / 2 + 2;
  if (dir === "up") ctx.fillRect(cx - bw / 2, cy - bl, bw, bl);
  else if (dir === "down") ctx.fillRect(cx - bw / 2, cy, bw, bl);
  else if (dir === "left") ctx.fillRect(cx - bl, cy - bw / 2, bl, bw);
  else ctx.fillRect(cx, cy - bw / 2, bl, bw);

  // Hatch dot
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(cx - 1, cy - 1, 2, 2);
}

function drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion) {
  const maxAge = e.big ? 350 : 200;
  const tt = e.age / maxAge;
  const radius = e.big ? 16 : 8;
  const r = radius * (0.4 + tt * 0.8);
  ctx.fillStyle = tt < 0.4 ? "#fef3c7" : "rgba(254,243,199,0.6)";
  ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
  ctx.fillStyle = tt < 0.5 ? "#f59e0b" : "#dc2626";
  const ir = r * 0.6;
  ctx.fillRect(e.x - ir, e.y - ir, ir * 2, ir * 2);
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
