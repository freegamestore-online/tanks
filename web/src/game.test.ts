import { describe, expect, it } from "vitest";
import {
  ENEMY_POINTS, LEVELS, STAGE_BONUS, TANK_SIZE, TILE_PX, T_EAGLE, T_EMPTY,
  freshStateForStage, parseField, stepGame, type Bullet, type GameState, type Tank,
} from "./game";
import type { Input } from "./input";

const idle: Input = { up: false, down: false, left: false, right: false, fire: false };

function enemyAt(s: GameState, x: number, y: number, kind: "basic" | "armor" = "basic"): Tank {
  const e: Tank = {
    id: s.nextTankId++, x, y, dir: "down", isEnemy: true, kind, hp: kind === "armor" ? 3 : 1,
    alive: true, cooldown: 99999, aiTimer: 99999, spawnFlash: 0,
  };
  s.enemies.push(e);
  return e;
}

/** Stage-1 state on an empty field, so walls don't get in the way. */
function openField(lives = 3): GameState {
  const s = freshStateForStage(1, lives, 0);
  s.field = s.field.map((row) => row.map(() => T_EMPTY));
  return s;
}

function bullet(x: number, y: number, dir: Bullet["dir"], ownerEnemy: boolean): Bullet {
  return { ownerId: ownerEnemy ? 99 : 0, x, y, dir, ownerEnemy, alive: true, trail: [] };
}

describe("levels", () => {
  it("keep every spawn patch empty and the eagle in place", () => {
    for (let stage = 1; stage <= LEVELS.length; stage++) {
      const f = parseField(stage);
      for (const [r, c] of [[0, 0], [0, 5], [0, 11], [10, 3]] as const) {
        expect([f[r]![c], f[r]![c + 1], f[r + 1]![c], f[r + 1]![c + 1]]).toEqual([T_EMPTY, T_EMPTY, T_EMPTY, T_EMPTY]);
      }
      expect(f[12]![6]).toBe(T_EAGLE);
    }
  });
});

describe("stepGame", () => {
  it("scores a kill and clears the stage with the survive bonus", () => {
    const s = openField();
    s.spawnQueue = [];
    const e = enemyAt(s, 6 * TILE_PX, 3 * TILE_PX);
    s.bullets.push(bullet(e.x + TANK_SIZE / 2, e.y + TANK_SIZE + 2, "up", false));
    stepGame(s, 16, idle, null);
    expect(s.enemies).toHaveLength(0);
    expect(s.killsThisStage).toBe(1);
    expect(s.stageCleared).toBe(true);
    expect(s.totalScore).toBe(ENEMY_POINTS.basic + STAGE_BONUS);
  });

  it("needs three hits for armor", () => {
    const s = openField();
    const e = enemyAt(s, 6 * TILE_PX, 3 * TILE_PX, "armor");
    s.bullets.push(bullet(e.x + TANK_SIZE / 2, e.y + TANK_SIZE + 2, "up", false));
    stepGame(s, 16, idle, null);
    expect(e.hp).toBe(2);
    expect(e.alive).toBe(true);
  });

  it("respawns the player and spends a life, then ends the game on the last life", () => {
    const s = freshStateForStage(1, 2, 0);
    s.player.spawnFlash = 0;
    s.bullets.push(bullet(s.player.x + TANK_SIZE / 2, s.player.y - 6, "down", true));
    stepGame(s, 16, idle, null);
    expect(s.lives).toBe(1);
    expect(s.player.alive).toBe(true);
    expect(s.gameOver).toBe(false);

    s.player.spawnFlash = 0;
    s.bullets.push(bullet(s.player.x + TANK_SIZE / 2, s.player.y - 6, "down", true));
    stepGame(s, 16, idle, null);
    expect(s.lives).toBe(0);
    expect(s.gameOver).toBe(true);
  });

  it("ends the game when the eagle is hit", () => {
    const s = freshStateForStage(1, 3, 0);
    s.field[11]![6] = T_EMPTY; // open the brick ring above the eagle
    s.bullets.push(bullet(6 * TILE_PX + 12, 11 * TILE_PX + 20, "down", true));
    stepGame(s, 16, idle, null);
    expect(s.baseAlive).toBe(false);
    expect(s.gameOver).toBe(true);
  });

  it("moves the player with input and blocks it at walls", () => {
    const s = openField();
    const x0 = s.player.x;
    stepGame(s, 20, { ...idle, right: true }, null);
    expect(s.player.x).toBeGreaterThan(x0);
    s.player.x = 0;
    stepGame(s, 20, { ...idle, left: true }, null);
    expect(s.player.x).toBe(0);
  });
});
