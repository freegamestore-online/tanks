import { describe, expect, it } from "vitest";
import { bindKeyboard, type Input } from "./input";

const fresh = (): Input => ({ up: false, down: false, left: false, right: false, fire: false });
const press = (type: "keydown" | "keyup", key: string) => {
  const e = new KeyboardEvent(type, { key, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe("bindKeyboard", () => {
  it("maps arrows/WASD and fire keys while playing", () => {
    const input = fresh();
    const unbind = bindKeyboard(input, () => true);
    expect(press("keydown", "ArrowLeft").defaultPrevented).toBe(true);
    press("keydown", "W");
    press("keydown", " ");
    expect(input).toMatchObject({ left: true, up: true, fire: true });
    press("keyup", "ArrowLeft");
    expect(input.left).toBe(false);
    unbind();
  });

  it("releases held keys when the window loses focus", () => {
    const input = fresh();
    const unbind = bindKeyboard(input, () => true);
    press("keydown", "ArrowUp");
    press("keydown", "x");
    window.dispatchEvent(new Event("blur"));
    expect(input).toEqual(fresh());
    unbind();
  });

  it("leaves Space/Enter to overlay buttons when not playing", () => {
    const input = fresh();
    const unbind = bindKeyboard(input, () => false);
    expect(press("keydown", "Enter").defaultPrevented).toBe(false);
    expect(press("keydown", " ").defaultPrevented).toBe(false);
    expect(input.fire).toBe(false);
    // Movement keys are still captured.
    expect(press("keydown", "ArrowDown").defaultPrevented).toBe(true);
    unbind();
  });

  it("stops listening after cleanup", () => {
    const input = fresh();
    bindKeyboard(input, () => true)();
    press("keydown", "ArrowUp");
    expect(input.up).toBe(false);
  });
});
