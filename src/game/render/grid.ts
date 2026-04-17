export const GRID_SIZE = 50;

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  width: number,
  height: number,
) => {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startX = Math.floor(cameraX / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(cameraY / GRID_SIZE) * GRID_SIZE;

  for (let x = startX; x < cameraX + width; x += GRID_SIZE) {
    ctx.moveTo(x, cameraY);
    ctx.lineTo(x, cameraY + height);
  }

  for (let y = startY; y < cameraY + height; y += GRID_SIZE) {
    ctx.moveTo(cameraX, y);
    ctx.lineTo(cameraX + width, y);
  }

  ctx.stroke();
};

export const drawWorldBorder = (
  ctx: CanvasRenderingContext2D,
  worldSize: number,
) => {
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, worldSize, worldSize);
};
