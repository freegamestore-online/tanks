import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const queueIcons = () => document.querySelectorAll("span[title]").length;

describe("App game loop", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    vi.spyOn(Math, "random").mockReturnValue(0.99); // enemies never fire
    // jsdom has no ResizeObserver; canvas sizing is irrelevant here.
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts a stage and refreshes the enemy queue strip when enemies spawn", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Start"));
    expect(screen.getByText("STAGE 1")).toBeInTheDocument();
    expect(queueIcons()).toBe(8);

    act(() => {
      vi.advanceTimersByTime(1800); // stage intro
    });
    expect(screen.queryByText("STAGE 1")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000); // first spawn after 600ms of play
    });
    expect(queueIcons()).toBe(7);
  }, 30_000);
});
