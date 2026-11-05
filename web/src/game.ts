import type { Input } from "./input";

type Sounds = { playMove(): void; playTick(): void; playError(): void; playGameOver(): void };


// Battle-City-style 13×13 field. NES feel.

export const COLS = 13;
export const ROWS = 13;
export const TILE_PX = 28;
export const FIELD_W = COLS * TILE_PX;
export const FIELD_H = ROWS * TILE_PX;

export const TANK_SIZE = 2 * TILE_PX;
export const PLAYER_SPEED = 0.12; // px per ms
export const BULLET_SPEED = 0.36;
export const FIRE_COOLDOWN = 380;

export const STAGE_BONUS = 500;
export const START_LIVES = 3;
export const MAX_LIVE_ENEMIES = 3;

export const T_EMPTY = 0;
export const T_BRICK = 1;
export const T_STEEL = 2;
export const T_WATER = 3;
export const T_BUSH = 4;
export const T_EAGLE = 5;
export type Tile = 0 | 1 | 2 | 3 | 4 | 5;

export type Dir = "up" | "down" | "left" | "right";
export const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export type EnemyKind = "basic" | "fast" | "armor";
export const ENEMY_SPEED: Record<EnemyKind, number> = { basic: 0.075, fast: 0.13, armor: 0.06 };
export const ENEMY_POINTS: Record<EnemyKind, number> = { basic: 100, fast: 200, armor: 400 };
export const ENEMY_HP: Record<EnemyKind, number> = { basic: 1, fast: 1, armor: 3 };

export interface Tank {
  id: number;
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

export interface Bullet {
  ownerId: number; // tank.id that fired
  x: number;
  y: number;
  dir: Dir;
  ownerEnemy: boolean;
  alive: boolean;
  trail: Array<{ x: number; y: number }>;
}

export interface Explosion {
  x: number;
  y: number;
  age: number;
  big: boolean;
}

export interface ScorePopup {
  x: number;
  y: number;
  points: number;
  age: number;
}

export interface GameState {
  field: Tile[][];
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  explosions: Explosion[];
  popups: ScorePopup[];
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
  nextTankId: number;
}

// ──────────── LEVELS ────────────
// Each level is a 13-row × 13-col layout. Player spawns at (col 3, row 10),
// occupying cols 3-4 / rows 10-11. Enemies spawn at three top-of-field 2×2
// patches: (cols 0-1, rows 0-1), (cols 5-6, rows 0-1), (cols 11-12, rows 0-1).
// All four 2×2 spawn patches MUST be empty in every layout.
// Eagle (E) is at (row 12, col 6); protective bricks at (11, 5-7), (12, 5+7).
//
// B = brick (destructible) · S = steel · W = water · X = bush (cover)

export const LEVEL_1: string[] = [
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

export const LEVEL_2: string[] = [
  ".............",
  "..BB.....BB..",
  "..BB.....BB..",
  "B...........B",
  "B.B.B.B.B.B.B",
  ".............",
  ".B...X.X...B.",
  ".S...S.S...S.",
  ".............",
  "B.B.B.B.B.B.B",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

export const LEVEL_3: string[] = [
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

export const LEVEL_4: string[] = [
  ".............",
  "..BB.....BB..",
  "..BB.....BB..",
  "......S......",
  "BB.S.....S.BB",
  ".............",
  ".X..S.S.S..X.",
  ".............",
  "BB.S.....S.BB",
  "......S......",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

export const LEVEL_5: string[] = [
  ".............",
  "..BB.....BB..",
  ".SSSS...SSSS.",
  ".............",
  "..XX.....XX..",
  "..B.S...S.B..",
  ".............",
  "..B.S...S.B..",
  "..XX.....XX..",
  ".SSS.....SSS.",
  ".............",
  ".....BBB.....",
  ".....BEB.....",
];

export const LEVELS: string[][] = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5];

// Enemy compositions per stage (left → right = first spawn → last)
export const STAGE_ENEMIES: EnemyKind[][] = [
  ["basic", "basic", "basic", "basic", "basic", "basic", "basic", "basic"],
  ["basic", "basic", "fast", "basic", "fast", "basic", "fast", "fast", "basic", "fast"],
  ["fast", "basic", "armor", "fast", "armor", "fast", "armor", "fast", "armor", "armor", "fast", "armor"],
  ["basic", "fast", "fast", "armor", "fast", "armor", "fast", "armor", "fast", "armor", "armor", "armor", "fast", "armor"],
  ["armor", "fast", "armor", "fast", "armor", "fast", "armor", "armor", "fast", "armor", "armor", "armor", "fast", "armor", "armor", "armor"],
];

export function parseField(stage: number): Tile[][] {
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

export function tankAabb(t: Tank) {
  return { x: t.x, y: t.y, w: TANK_SIZE, h: TANK_SIZE };
}

export function intersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function tileAt(field: Tile[][], px: number, py: number): Tile {
  const c = Math.floor(px / TILE_PX);
  const r = Math.floor(py / TILE_PX);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T_STEEL;
  return field[r]![c]!;
}

export function blocksTank(t: Tile): boolean {
  return t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_EAGLE;
}

export function canTankOccupy(field: Tile[][], x: number, y: number): boolean {
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

export const PLAYER_SPAWN = { x: 3 * TILE_PX, y: 10 * TILE_PX };

// Player always reuses id=0 across respawns — that's the unique "player slot".
export function freshPlayer(): Tank {
  return {
    id: 0,
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

export function freshStateForStage(stage: number, carryLives: number, carryScore: number): GameState {
  const queue = STAGE_ENEMIES[Math.min(stage - 1, STAGE_ENEMIES.length - 1)] ?? STAGE_ENEMIES[0]!;
  return {
    field: parseField(stage),
    player: freshPlayer(),
    enemies: [],
    bullets: [],
    explosions: [],
    popups: [],
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
    nextTankId: 1, // 0 reserved for player
  };
}

export function spawnEnemy(s: GameState): boolean {
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
      id: s.nextTankId++,
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

export function tryMove(
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

export function fire(t: Tank, s: GameState): boolean {
  if (t.cooldown > 0) return false;
  // NES rule: one bullet per tank in flight at a time.
  for (const b of s.bullets) {
    if (b.alive && b.ownerId === t.id) return false;
  }
  t.cooldown = FIRE_COOLDOWN;
  const v = DIR_VEC[t.dir];
  const cx = t.x + TANK_SIZE / 2;
  const cy = t.y + TANK_SIZE / 2;
  const offset = TANK_SIZE / 2 + 2;
  s.bullets.push({
    ownerId: t.id,
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
// Outcome priority: base > brick > steel > none. Even if a corner clips
// steel, if the bullet also smashed brick, we report "brick" so the right
// sound + popup play.
export function damageBullet(s: GameState, b: Bullet): "brick" | "steel" | "base" | null {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [b.x, b.y],
    [b.x + 3, b.y],
    [b.x, b.y + 3],
    [b.x + 3, b.y + 3],
  ];
  let hitBase = false;
  let hitBrick = false;
  let hitSteel = false;
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
      hitBrick = true;
    } else if (t === T_STEEL) {
      hitSteel = true;
    } else if (t === T_EAGLE) {
      s.baseAlive = false;
      s.gameOver = true;
      hitBase = true;
    }
  }
  if (bricks.length > 0) for (const [r, c] of bricks) s.field[r]![c] = T_EMPTY;
  if (hitBase) return "base";
  if (hitBrick) return "brick";
  if (hitSteel) return "steel";
  return null;
}

/** Destroy an enemy: score it, count the kill, spawn the explosion and popup. */
function killEnemy(s: GameState, e: Tank) {
  e.alive = false;
  s.killsThisStage++;
  const kind = e.kind as EnemyKind;
  s.killsByKind[kind]++;
  const pts = ENEMY_POINTS[kind];
  s.totalScore += pts;
  s.explosions.push({ x: e.x + TANK_SIZE / 2, y: e.y + TANK_SIZE / 2, age: 0, big: true });
  s.popups.push({ x: e.x + TANK_SIZE / 2, y: e.y + TANK_SIZE / 2, points: pts, age: 0 });
}

/** Advance one frame of play by `dt` ms. Mutates `s`; sounds are optional. */
export function stepGame(s: GameState, dt: number, input: Input, sounds: Sounds | null) {
    // Player movement
    if (s.player.alive) {
      s.player.spawnFlash = Math.max(0, s.player.spawnFlash - dt);
      s.player.cooldown = Math.max(0, s.player.cooldown - dt);
      const inp = input;
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
        if (fire(s.player, s)) sounds?.playMove();
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
      const speed = ENEMY_SPEED[e.kind as EnemyKind];
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
            sounds?.playMove();
            s.explosions.push({ x: cx, y: cy, age: 0, big: false });
          } else if (wall === "steel") {
            sounds?.playTick();
            s.explosions.push({ x: cx, y: cy, age: 0, big: false });
          } else if (wall === "base") {
            sounds?.playGameOver();
            s.explosions.push({ x: cx, y: cy, age: 0, big: true });
          }
          hit = "wall";
          break;
        }
        const bbox = { x: b.x, y: b.y, w: 4, h: 4 };
        // Bullet-vs-bullet cancel (player bullet meets enemy bullet)
        let canceled = false;
        for (const other of s.bullets) {
          if (other === b || !other.alive) continue;
          if (other.ownerEnemy === b.ownerEnemy) continue;
          const obox = { x: other.x, y: other.y, w: 4, h: 4 };
          if (intersects(bbox, obox)) {
            other.alive = false;
            s.explosions.push({ x: (b.x + other.x) / 2 + 2, y: (b.y + other.y) / 2 + 2, age: 0, big: false });
            canceled = true;
            break;
          }
        }
        if (canceled) { hit = "tank"; break; }

        if (!b.ownerEnemy) {
          for (const e of s.enemies) {
            if (!e.alive) continue;
            if (intersects(bbox, tankAabb(e))) {
              e.hp -= 1;
              if (e.hp <= 0) {
                killEnemy(s, e);
                sounds?.playError();
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
          sounds?.playError();
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

    // Age score popups (rise + fade over 800 ms)
    const livePopups: ScorePopup[] = [];
    for (const p of s.popups) {
      p.age += dt;
      if (p.age < 800) livePopups.push(p);
    }
    s.popups = livePopups;

    // Cull dead bullets too (canceled bullets get marked alive=false above)
    s.bullets = s.bullets.filter((b) => b.alive);

    s.enemies = s.enemies.filter((e) => e.alive);

    // Player respawn / lives / win / lose
    if (!s.player.alive && !s.gameOver && !s.stageCleared) {
      if (s.lives > 1) {
        s.lives--;
        s.player = freshPlayer();
        // Ram-kill: any enemy overlapping the respawn point dies (worth points)
        for (const e of s.enemies) {
          if (!e.alive) continue;
          if (intersects(tankAabb(s.player), tankAabb(e))) {
            killEnemy(s, e);
          }
        }
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

}
