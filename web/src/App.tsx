import { GameShell, GameTopbar, GameAuth } from "@freegamestore/games";

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="tanks" score={0} />}>
      <GameAuth />
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <h1
          className="text-3xl font-bold"
          style={{ fontFamily: "Fraunces, serif" }}
        >
          tanks
        </h1>
        <p style={{ color: "var(--muted)" }}>
          Edit <code>src/App.tsx</code> to build your game.
        </p>
      </div>
    </GameShell>
  );
}
