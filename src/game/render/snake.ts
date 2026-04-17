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
  const gradient = ctx.createRadialGradient(
    x - radius * 0.38,
    y - radius * 0.42,
    radius * 0.15,
    x,
    y,
    radius,
  );
  gradient.addColorStop(0, mixColors(fillColor, highlightColor, 0.72));
  gradient.addColorStop(0.52, fillColor);
  gradient.addColorStop(1, mixColors(fillColor, '#050505', 0.28));

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(highlightColor, 0.22);
  ctx.lineWidth = Math.max(1, radius * 0.08);
  ctx.stroke();
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
  interpolatedHead: Vector2,
  camera: Camera,
) => {
  const skin = player.appearance ?? DEFAULT_SNAKE_APPEARANCE;
  const palette = getSnakePalette(skin.paletteId);
  const totalSegments = player.segments.length;
  const head = interpolatedHead;

  for (let i = player.segments.length - 1; i > 0; i--) {
    const segment = player.segments[i];
    if (isInViewport(segment.x, segment.y, camera, 30)) {
      const radius = getSegmentRadius(i, totalSegments, skin, 15);
      const fillColor = getSegmentColor(i, totalSegments, skin);
      drawSegmentCircle(ctx, segment.x, segment.y, radius, fillColor, palette.highlight);
    }
  }

  if (isInViewport(head.x, head.y, camera, 30)) {
    const angle = Math.atan2(player.velocity.y, player.velocity.x);
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
