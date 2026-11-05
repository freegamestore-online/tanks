import { useEffect, useRef, useState, useCallback } from "react";
import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
} from "@freegamestore/games";
import { useHighScore } from "./hooks/useHighScore";
import { bindKeyboard, type Input } from "./input";
import { drawGame } from "./draw";
import {
  ENEMY_POINTS, FIELD_H, FIELD_W, LEVELS, STAGE_BONUS, STAGE_ENEMIES, START_LIVES,
  freshStateForStage, stepGame, type EnemyKind, type GameState,
} from "./game";

// useGameSounds reads SoundContext which GameShell provides INTERNALLY.
// Calling it directly above <GameShell> would get a disconnected (muted)
// default; AudioBridge is a tiny no-render child of GameShell that exposes
// the real sounds API via ref to the App scope.
type SoundsApi = ReturnType<typeof useGameSounds>;

function AudioBridge({ apiRef }: { apiRef: React.MutableRefObject<SoundsApi | null> }) {
  const sounds = useGameSounds();
  apiRef.current = sounds;
  return null;
}

// ──────────── React component ────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(freshStateForStage(1, START_LIVES, 0));
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false, fire: false });
  const lastTimeRef = useRef(0);
  const killsRef = useRef(0);
  const queueLeftRef = useRef(-1);
  const livesRef = useRef(START_LIVES);
  const scoreRef = useRef(0);
  const stageRef = useRef(1);
  const phaseRef = useRef<Phase>("intro");
  const pausedRef = useRef(false);
  const soundsRef = useRef<SoundsApi | null>(null);

  const [stage, setStage] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [kills, setKills] = useState(0);
  // Only re-renders the queue strip, which reads stateRef.current.spawnQueue.
  const [, setQueueLeft] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [paused, setPaused] = useState(false);
  const [stageClearSummary, setStageClearSummary] = useState<StageSummary | null>(null);
  const [bestScore, updateHighScore] = useHighScore("tanks-best");
  const [bestStage, updateBestStage] = useHighScore("tanks-best-stage");

  phaseRef.current = phase;
  pausedRef.current = paused;

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
    setPaused(false);
    setPhase("stage-intro");
  }, []);

  const advanceToNextStage = useCallback(() => {
    const cur = stateRef.current;
    const nextStage = cur.stage + 1;
    if (nextStage > LEVELS.length) {
      // Player beat every stage — record the win as the top of the score
      // ladder. (Was previously a silent miss: bestScore/bestStage only
      // updated on the game-over path.)
      updateHighScore(cur.totalScore);
      updateBestStage(cur.stage);
      setPhase("won");
      soundsRef.current?.playLevelUp();
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
  }, [updateHighScore, updateBestStage]);

  // Keyboard
  useEffect(
    () => bindKeyboard(inputRef.current, () => phaseRef.current === "playing" && !pausedRef.current),
    [],
  );

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
      if (phaseRef.current === "playing" && !pausedRef.current) step(s, dt);
      draw(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useCallback(
    (s: GameState, dt: number) => {
      stepGame(s, dt, inputRef.current, soundsRef.current);

      // Sync React state minimally
      if (s.killsThisStage !== killsRef.current) {
        killsRef.current = s.killsThisStage;
        setKills(s.killsThisStage);
      }
      if (s.spawnQueue.length !== queueLeftRef.current) {
        queueLeftRef.current = s.spawnQueue.length;
        setQueueLeft(s.spawnQueue.length);
      }
      if (s.lives !== livesRef.current) {
        livesRef.current = s.lives;
        setLives(s.lives);
      }
      if (s.totalScore !== scoreRef.current) {
        scoreRef.current = s.totalScore;
        setScore(s.totalScore);
      }

      // Phase transitions — flip phaseRef synchronously to prevent the next
      // animation frame (before React rerenders) from re-entering and firing
      // the sound / setState a dozen times.
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
        phaseRef.current = "stage-clear";
        soundsRef.current?.playLevelUp();
      }
      if (s.gameOver && phaseRef.current === "playing") {
        updateHighScore(s.totalScore);
        updateBestStage(s.stage);
        setPhase("over");
        phaseRef.current = "over";
        soundsRef.current?.playGameOver();
      }
    },
    [updateHighScore, updateBestStage],
  );


  const draw = useCallback((s: GameState) => {
    if (canvasRef.current) drawGame(canvasRef.current, s);
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
      // Capture the pointer on press so the input stays bound to this button
      // even if the finger drifts to an edge/corner or slightly off — otherwise
      // a tiny jitter fires pointerleave and the tank stops mid-move.
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setInput(k, true);
      }}
      onPointerUp={() => setInput(k, false)}
      onPointerCancel={() => setInput(k, false)}
      onLostPointerCapture={() => setInput(k, false)}
      aria-label={k}
      style={{
        width: "3.75rem",
        height: "3.75rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        borderRadius: "0.5rem",
        color: "var(--ink)",
        fontFamily: "Fraunces, serif",
        fontWeight: 700,
        fontSize: "1.4rem",
        // "none" (not "manipulation") so the browser never reinterprets the
        // touch as a scroll/pan and cancels the press.
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
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
          onPlayPause={phase === "playing" ? () => setPaused((p) => !p) : undefined}
          paused={paused}
          actions={<GameAuth />}
        />
      }
    >
      <AudioBridge apiRef={soundsRef} />
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
          {/* Canvas + CRT scanline overlay sit inside a wrapper so the
              scanlines align to the visible canvas. */}
          <div
            style={{
              position: "relative",
              maxWidth: "100%",
              maxHeight: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px",
              background: "linear-gradient(180deg, #422006 0%, #2c1404 100%)",
              border: "3px solid #facc15",
              borderRadius: "0.4rem",
              boxShadow: "0 0 0 1px #000 inset, 0 4px 24px rgba(0,0,0,0.5)",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                imageRendering: "pixelated",
                background: "#000",
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                touchAction: "none",
              }}
            />
            {/* Subtle CRT scanlines */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 6,
                pointerEvents: "none",
                background:
                  "repeating-linear-gradient(to bottom, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px)",
                mixBlendMode: "multiply",
                borderRadius: "0.15rem",
              }}
            />
          </div>
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
          {phase === "playing" && paused && (
            <Overlay>
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 800, fontSize: "1.5rem", color: "#facc15" }}>
                PAUSED
              </div>
              <GameButton size="md" variant="primary" onClick={() => setPaused(false)}>Resume</GameButton>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "0.35rem" }}>
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
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              inputRef.current.fire = true;
            }}
            onPointerUp={() => (inputRef.current.fire = false)}
            onPointerCancel={() => (inputRef.current.fire = false)}
            onLostPointerCapture={() => (inputRef.current.fire = false)}
            aria-label="Fire"
            style={{
              width: "5.5rem",
              height: "5.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              background: "var(--accent)",
              color: "var(--paper)",
              border: "none",
              borderRadius: "50%",
              fontFamily: "Fraunces, serif",
              fontWeight: 800,
              fontSize: "1.25rem",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTapHighlightColor: "transparent",
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
