import { useEffect, useRef } from "react";

/**
 * Reusable game loop hook using requestAnimationFrame.
 * Calls `callback` every frame with delta time in seconds.
 * Pauses when `paused` is true.
 */
export function useGameLoop(callback: (dt: number) => void, paused = false): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (paused) return;

    let lastTime = performance.now();
    let frameId: number;

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
      lastTime = now;
      callbackRef.current(dt);
      frameId = requestAnimationFrame(loop);
    }

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [paused]);
}
