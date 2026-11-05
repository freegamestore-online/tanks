export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

const KEY_ACTIONS: Record<string, keyof Input> = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
  " ": "fire", Enter: "fire", k: "fire", K: "fire", x: "fire", X: "fire",
};

export function clearInput(input: Input) {
  input.up = input.down = input.left = input.right = input.fire = false;
}

/**
 * Bind keyboard controls to `input`. Fire keys are only captured while
 * `fireActive()` is true, so Space/Enter still press the overlay buttons
 * (Start, Resume, Next Stage, Try Again). Losing window focus releases every
 * key, since the matching keyup never arrives. Returns the cleanup.
 */
export function bindKeyboard(input: Input, fireActive: () => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    const action = KEY_ACTIONS[e.key];
    if (!action || (action === "fire" && !fireActive())) return;
    input[action] = true;
    e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    const action = KEY_ACTIONS[e.key];
    if (action) input[action] = false;
  };
  const blur = () => clearInput(input);
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}
