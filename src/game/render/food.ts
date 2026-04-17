import { Food } from '../../shared/types';
import { hueToHsl } from './colors';
import { Camera } from './snake';

const glowSpriteCache = new Map<string, HTMLCanvasElement>();

const getGlowSprite = (radius: number, color: string, glowStrength: number): HTMLCanvasElement => {
  const key = `${color}|${radius}|${glowStrength}`;
  let sprite = glowSpriteCache.get(key);
  if (sprite) return sprite;

  const padding = glowStrength * 2;
  const size = (radius + padding) * 2;
  sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;

  const sctx = sprite.getContext('2d')!;
  sctx.fillStyle = color;
  sctx.shadowBlur = glowStrength;
  sctx.shadowColor = color;
  sctx.beginPath();
  sctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  sctx.fill();

  glowSpriteCache.set(key, sprite);
  return sprite;
};

export const drawFoodBlob = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  glowStrength: number,
) => {
  const sprite = getGlowSprite(radius, color, glowStrength);
  ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
};

export const drawFoods = (
  ctx: CanvasRenderingContext2D,
  foods: Record<string, Food>,
  camera: Camera,
) => {
  for (const foodId in foods) {
    const food = foods[foodId];
    if (
      food.position.x > camera.x - 20 &&
      food.position.x < camera.x + camera.width + 20 &&
      food.position.y > camera.y - 20 &&
      food.position.y < camera.y + camera.height + 20
    ) {
      drawFoodBlob(ctx, food.position.x, food.position.y, 5 + food.value, hueToHsl(food.hue), 10);
    }
  }
};

export const pruneDistantFoods = (
  foods: Record<string, Food>,
  centerX: number,
  centerY: number,
  margin: number,
) => {
  const pruneSq = margin * margin;
  for (const foodId in foods) {
    const pos = foods[foodId].position;
    const dx = pos.x - centerX;
    const dy = pos.y - centerY;
    if (dx * dx + dy * dy > pruneSq) {
      delete foods[foodId];
    }
  }
};
