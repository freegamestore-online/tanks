import { useEffect, useRef } from "react";

export interface Controls {
  keys: Set<string>;
  mouse: { x: number; y: number; down: boolean };
  touch: { x: number; y: number; active: boolean };
}

/**
 * Reusable input hook tracking keyboard, mouse, and touch state.
 * Returns a stable ref-based object that updates every frame without re-renders.
 */
export function useControls(): Controls {
  const controlsRef = useRef<Controls>({
    keys: new Set(),
    mouse: { x: 0, y: 0, down: false },
    touch: { x: 0, y: 0, active: false },
  });

  useEffect(() => {
    const controls = controlsRef.current;

    function onKeyDown(e: KeyboardEvent) {
      controls.keys.add(e.key);
      // Prevent arrow key page scrolling
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      controls.keys.delete(e.key);
    }

    function onMouseMove(e: MouseEvent) {
      controls.mouse.x = e.clientX;
      controls.mouse.y = e.clientY;
    }

    function onMouseDown() {
      controls.mouse.down = true;
    }

    function onMouseUp() {
      controls.mouse.down = false;
    }

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (t) {
        controls.touch.x = t.clientX;
        controls.touch.y = t.clientY;
        controls.touch.active = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (t) {
        controls.touch.x = t.clientX;
        controls.touch.y = t.clientY;
      }
    }

    function onTouchEnd() {
      controls.touch.active = false;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return controlsRef.current;
}
