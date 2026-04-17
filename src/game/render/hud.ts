import { WorldSummary } from '../../shared/types';
import { getSnakePalette } from '../../shared/skins';
import { Camera } from './snake';

const LEADERBOARD_CACHE_MS = 500;

export type LeaderboardCache = {
  get: (now: number, summary: WorldSummary, myId: string | null) => {
    top5: WorldSummary['players'];
    myRank: number;
  };
};

export const createLeaderboardCache = (): LeaderboardCache => {
  let cached: { top5: WorldSummary['players']; myRank: number } | null = null;
  let cachedAt = 0;

  return {
    get(now, summary, myId) {
      if (!cached || now - cachedAt > LEADERBOARD_CACHE_MS) {
        const sorted = [...summary.players].sort((a, b) => b.score - a.score);
        cached = {
          top5: sorted.slice(0, 5),
          myRank: sorted.findIndex((p) => p.id === myId) + 1,
        };
        cachedAt = now;
      }
      return cached;
    },
  };
};

export const drawScore = (
  ctx: CanvasRenderingContext2D,
  score: number,
  viewportHeight: number,
) => {
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 20, viewportHeight - 24);
};

export const drawPlayerCount = (
  ctx: CanvasRenderingContext2D,
  count: number,
  viewportHeight: number,
) => {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '14px Arial';
  ctx.fillText(`${count} player${count !== 1 ? 's' : ''} alive`, 20, viewportHeight - 50);
};

export const drawLeaderboard = (
  ctx: CanvasRenderingContext2D,
  summary: WorldSummary,
  myId: string | null,
  myName: string,
  myScore: number,
  viewportWidth: number,
  cache: LeaderboardCache,
  now: number,
) => {
  const { top5, myRank } = cache.get(now, summary, myId);

  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('Leaderboard', viewportWidth - 20, 30);
  ctx.font = '16px Arial';

  top5.forEach((player, index) => {
    ctx.fillStyle = player.id === myId ? 'yellow' : 'white';
    ctx.fillText(`${index + 1}. ${player.name}: ${player.score}`, viewportWidth - 20, 60 + index * 25);
  });

  if (myRank > 5) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText('···', viewportWidth - 20, 60 + 5 * 25);
    ctx.fillStyle = 'yellow';
    ctx.fillText(`${myRank}. ${myName}: ${myScore}`, viewportWidth - 20, 60 + 6 * 25);
  }
};

export const drawMinimap = (
  ctx: CanvasRenderingContext2D,
  summary: WorldSummary,
  myId: string | null,
  myHead: { x: number; y: number },
  camera: Camera,
  worldSize: number,
) => {
  const mmSize = 140;
  const mmPad = 14;
  const mmX = camera.width - mmSize - mmPad;
  const mmY = camera.height - mmSize - mmPad;
  const mmScale = mmSize / worldSize;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(mmX, mmY, mmSize, mmSize);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmSize, mmSize);

  for (const playerSummary of summary.players) {
    if (playerSummary.id === myId) continue;
    const px = mmX + playerSummary.position.x * mmScale;
    const py = mmY + playerSummary.position.y * mmScale;
    ctx.fillStyle = getSnakePalette(playerSummary.appearance.paletteId).primary;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = mmX + myHead.x * mmScale;
  const my = mmY + myHead.y * mmScale;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
  ctx.fill();

  const vpX = mmX + camera.x * mmScale;
  const vpY = mmY + camera.y * mmScale;
  const vpW = camera.width * mmScale;
  const vpH = camera.height * mmScale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
};
