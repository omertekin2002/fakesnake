import { hueToHsl } from './colors';
import { drawFoodBlob } from './food';
import { drawGrid } from './grid';

export type MenuFood = {
  x: number;
  y: number;
  value: number;
  hue: number;
  driftOffset: number;
  driftSpeed: number;
};

const MENU_DRIFT_RANGE = 18;

export const createMenuFoods = (width: number, height: number): MenuFood[] => {
  const count = Math.max(35, Math.floor((width * height) / 22000));

  return Array.from({ length: count }, (_, index) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    value: (index % 5) + 1,
    hue: (index * 47) % 360,
    driftOffset: Math.random() * Math.PI * 2,
    driftSpeed: 0.6 + Math.random() * 0.8,
  }));
};

export const renderMenuScene = (
  ctx: CanvasRenderingContext2D,
  foods: MenuFood[],
  width: number,
  height: number,
  time: number,
) => {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, 0, 0, width, height);

  for (const food of foods) {
    const drift = Math.sin(time * 0.001 * food.driftSpeed + food.driftOffset) * MENU_DRIFT_RANGE;
    const verticalDrift = Math.cos(time * 0.0012 * food.driftSpeed + food.driftOffset) * (MENU_DRIFT_RANGE * 0.65);
    const color = hueToHsl(food.hue);
    drawFoodBlob(
      ctx,
      food.x + drift,
      food.y + verticalDrift,
      5 + food.value,
      color,
      10 + food.value * 1.5,
    );
  }

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.15,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.7,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
};
