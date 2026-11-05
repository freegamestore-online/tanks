import {
  COLS, FIELD_H, FIELD_W, ROWS, T_BRICK, T_BUSH, T_EAGLE, T_EMPTY, T_STEEL, T_WATER, TANK_SIZE, TILE_PX,
  type Explosion, type GameState, type ScorePopup, type Tank, type Tile,
} from "./game";

export function drawGame(canvas: HTMLCanvasElement, s: GameState) {
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

  // Score popups (above everything)
  for (const p of s.popups) drawScorePopup(ctx, p);
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

function drawScorePopup(ctx: CanvasRenderingContext2D, p: ScorePopup) {
  const t = p.age / 800;
  const yOffset = -16 * t;
  const alpha = Math.max(0, 1 - t);
  const text = `+${p.points}`;
  ctx.font = "bold 11px 'Fraunces', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shadow first
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
  ctx.fillText(text, p.x + 1, p.y + yOffset + 1);
  // Foreground on top
  ctx.fillStyle = `rgba(254, 243, 199, ${alpha})`;
  ctx.fillText(text, p.x, p.y + yOffset);
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
