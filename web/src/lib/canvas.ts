/** Draw a radial gradient glow */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, hexToRgba(color, 0.6));
  gradient.addColorStop(1, hexToRgba(color, 0));
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Draw text with optional shadow/outline */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    font?: string;
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    shadow?: string;
    shadowBlur?: number;
  } = {},
): void {
  ctx.save();
  ctx.font = opts.font ?? "16px Manrope, sans-serif";
  ctx.fillStyle = opts.color ?? "#ffffff";
  ctx.textAlign = opts.align ?? "center";
  ctx.textBaseline = opts.baseline ?? "middle";
  if (opts.shadow) {
    ctx.shadowColor = opts.shadow;
    ctx.shadowBlur = opts.shadowBlur ?? 8;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Convert hex color to rgba string */
export function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Distance between two points */
export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/** Angle from (x1,y1) to (x2,y2) in radians */
export function angleTo(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** Random number in range [min, max] */
export function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random hex color */
export function randomColor(): string {
  const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd", "#00d2d3", "#1dd1a1"];
  return colors[Math.floor(Math.random() * colors.length)]!;
}
