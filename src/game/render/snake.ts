import { Player, Vector2 } from '../../shared/types';
import {
  DEFAULT_SNAKE_APPEARANCE,
  getSnakePalette,
  getSnakePattern,
  getSnakeTaper,
  SnakeAppearance,
} from '../../shared/skins';
import { mixColors, withAlpha } from './colors';

export const getSegmentProgress = (segmentIndex: number, totalSegments: number): number => {
  if (totalSegments <= 1) return 0;
  return Math.max(0, Math.min(1, segmentIndex / (totalSegments - 1)));
};

export const getPatternStrength = (
  segmentIndex: number,
  totalSegments: number,
  appearance: SnakeAppearance,
): number => {
  const mode = getSnakePattern(appearance.patternId).mode;
  const progress = getSegmentProgress(segmentIndex, totalSegments);

  switch (mode) {
    case 'bands':
      return segmentIndex % 7 < 2 ? 0.9 : 0.12;
    case 'tiger':
      return Math.sin(segmentIndex * 0.9 + progress * 5) > 0.22 ? 0.82 : 0.08;
    case 'saddle':
      return segmentIndex % 10 < 4 ? 0.72 : (progress > 0.72 ? 0.35 : 0.08);
    case 'racer':
      return segmentIndex % 6 === 0 ? 1 : (segmentIndex % 3 === 0 ? 0.34 : 0.04);
    default:
      return 0.1;
  }
};

export const getSegmentRadius = (
  segmentIndex: number,
  totalSegments: number,
  appearance: SnakeAppearance,
  headRadius: number,
): number => {
  const taper = getSnakeTaper(appearance.taperId);
  const progress = getSegmentProgress(segmentIndex, totalSegments);
  const scale = 1 - (1 - taper.tailScale) * Math.pow(progress, taper.curve);
  return Math.max(headRadius * 0.22, headRadius * 0.85 * scale);
};

export const getSegmentColor = (
  segmentIndex: number,
  totalSegments: number,
  appearance: SnakeAppearance,
): string => {
  const palette = getSnakePalette(appearance.paletteId);
  const progress = getSegmentProgress(segmentIndex, totalSegments);
  const base = mixColors(palette.primary, palette.secondary, 0.18 + progress * 0.45);
  const stripeStrength = getPatternStrength(segmentIndex, totalSegments, appearance);
  return mixColors(base, palette.stripe, stripeStrength);
};

export const drawSegmentCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fillColor: string,
  highlightColor: string,
) => {
  drawSegmentGradient(
    ctx,
    x,
    y,
    radius,
    mixColors(fillColor, highlightColor, 0.72),
    fillColor,
    mixColors(fillColor, '#050505', 0.28),
    withAlpha(highlightColor, 0.22),
  );
};

// Low-level draw using already-resolved colours, so the per-segment colour math
// (mixColors/withAlpha string parsing) can be memoized by the caller.
const drawSegmentGradient = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  litColor: string,
  fillColor: string,
  darkColor: string,
  strokeColor: string,
) => {
  const gradient = ctx.createRadialGradient(
    x - radius * 0.38,
    y - radius * 0.42,
    radius * 0.15,
    x,
    y,
    radius,
  );
  gradient.addColorStop(0, litColor);
  gradient.addColorStop(0.52, fillColor);
  gradient.addColorStop(1, darkColor);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1, radius * 0.08);
  ctx.stroke();
};

// A body segment's radius and three gradient stop colours are a pure function of
// (appearance, segmentIndex, totalSegments, headRadius). Computing them means
// several mixColors() calls, each regex-parsing colour strings — hundreds of
// times per frame for a long snake. They only change when the snake's length
// changes, so memoize them; cache is keyed by everything they depend on.
type BodySegmentStyle = { radius: number; fill: string; lit: string; dark: string };
const bodyStyleCache = new Map<string, BodySegmentStyle>();
const BODY_STYLE_CACHE_LIMIT = 60_000;

const getBodySegmentStyle = (
  appearance: SnakeAppearance,
  segmentIndex: number,
  totalSegments: number,
  headRadius: number,
  highlightColor: string,
): BodySegmentStyle => {
  const key = `${appearance.paletteId}:${appearance.patternId}:${appearance.taperId}:${segmentIndex}:${totalSegments}:${headRadius}`;
  const cached = bodyStyleCache.get(key);
  if (cached) return cached;

  const fill = getSegmentColor(segmentIndex, totalSegments, appearance);
  const style: BodySegmentStyle = {
    radius: getSegmentRadius(segmentIndex, totalSegments, appearance, headRadius),
    fill,
    lit: mixColors(fill, highlightColor, 0.72),
    dark: mixColors(fill, '#050505', 0.28),
  };
  // Bound memory across a long session: totals climb as snakes grow, so the key
  // space is unbounded. A wholesale clear is cheap relative to the per-frame win.
  if (bodyStyleCache.size >= BODY_STYLE_CACHE_LIMIT) bodyStyleCache.clear();
  bodyStyleCache.set(key, style);
  return style;
};

export type Camera = { x: number; y: number; width: number; height: number };

const isInViewport = (x: number, y: number, camera: Camera, margin: number): boolean =>
  x > camera.x - margin &&
  x < camera.x + camera.width + margin &&
  y > camera.y - margin &&
  y < camera.y + camera.height + margin;

export const drawSnake = (
  ctx: CanvasRenderingContext2D,
  player: Player,
  camera: Camera,
  velocityOverride?: Vector2,
) => {
  const skin = player.appearance ?? DEFAULT_SNAKE_APPEARANCE;
  const palette = getSnakePalette(skin.paletteId);
  const totalSegments = player.segments.length;

  const renderSegments = player.smoothSegments || player.segments;
  const head = renderSegments[0];

  // The stroke colour is constant for the whole snake, so resolve it once
  // instead of per segment.
  const segmentStroke = withAlpha(palette.highlight, 0.22);

  for (let i = renderSegments.length - 1; i > 0; i--) {
    const segment = renderSegments[i];
    if (isInViewport(segment.x, segment.y, camera, 30)) {
      const style = getBodySegmentStyle(skin, i, totalSegments, 15, palette.highlight);
      drawSegmentGradient(
        ctx,
        segment.x,
        segment.y,
        style.radius,
        style.lit,
        style.fill,
        style.dark,
        segmentStroke,
      );
    }
  }

  if (isInViewport(head.x, head.y, camera, 30)) {
    const velocity = velocityOverride ?? player.velocity;
    const angle = Math.atan2(velocity.y, velocity.x);
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    const px = -fy;
    const py = fx;
    const headRadius = 15.5;
    const headColor = mixColors(palette.primary, palette.stripe, 0.24);

    drawSegmentCircle(ctx, head.x, head.y, headRadius, headColor, palette.highlight);

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);
    ctx.fillStyle = withAlpha(palette.stripe, 0.72);
    const patternMode = getSnakePattern(skin.patternId).mode;
    if (patternMode === 'racer') {
      ctx.beginPath();
      ctx.ellipse(-1, 0, 7.5, 3.2, 0, 0, Math.PI * 2);
    } else if (patternMode === 'tiger') {
      ctx.beginPath();
      ctx.ellipse(-4.5, 0, 5, 10.5, 0, 0, Math.PI * 2);
    } else if (patternMode === 'saddle') {
      ctx.beginPath();
      ctx.ellipse(-2.5, 0, 6.5, 8.4, 0, 0, Math.PI * 2);
    } else {
      ctx.beginPath();
      ctx.ellipse(-1.5, 0, 5.8, 8.8, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    const eyeForward = 5;
    const eyeSpread = 5;
    const lx = head.x + fx * eyeForward + px * eyeSpread;
    const ly = head.y + fy * eyeForward + py * eyeSpread;
    const rx = head.x + fx * eyeForward - px * eyeSpread;
    const ry = head.y + fy * eyeForward - py * eyeSpread;

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(lx + 4, ly);
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.moveTo(rx + 4, ry);
    ctx.arc(rx, ry, 4, 0, Math.PI * 2);
    ctx.fill();

    const pupilOffset = 1.5;
    const plx = lx + fx * pupilOffset;
    const ply = ly + fy * pupilOffset;
    const prx = rx + fx * pupilOffset;
    const pry = ry + fy * pupilOffset;
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(plx + 2, ply);
    ctx.arc(plx, ply, 2, 0, Math.PI * 2);
    ctx.moveTo(prx + 2, pry);
    ctx.arc(prx, pry, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isInViewport(head.x, head.y, camera, 50)) {
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, head.x, head.y - 25);
  }
};
