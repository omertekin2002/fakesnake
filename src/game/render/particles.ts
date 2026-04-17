export type ScoreParticle = {
  x: number;
  y: number;
  value: number;
  createdAt: number;
};

export type DeathParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  createdAt: number;
};

const SCORE_PARTICLE_DURATION = 800;
const DEATH_PARTICLE_DURATION = 900;

export const drawScoreParticles = (
  ctx: CanvasRenderingContext2D,
  particles: ScoreParticle[],
  now: number,
) => {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const age = now - p.createdAt;
    if (age > SCORE_PARTICLE_DURATION) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    const t = age / SCORE_PARTICLE_DURATION;
    const alpha = 1 - t;
    const rise = t * 30;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'hsl(50, 100%, 70%)';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`+${p.value}`, p.x, p.y - 20 - rise);
  }
  ctx.globalAlpha = 1;
};

export const drawDeathParticles = (
  ctx: CanvasRenderingContext2D,
  particles: DeathParticle[],
  now: number,
) => {
  for (let i = particles.length - 1; i >= 0; i--) {
    const dp = particles[i];
    const age = now - dp.createdAt;
    if (age > DEATH_PARTICLE_DURATION) {
      particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    const t = age / DEATH_PARTICLE_DURATION;
    const ease = 1 - (1 - t) * (1 - t);
    const px = dp.x + dp.vx * ease;
    const py = dp.y + dp.vy * ease;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = dp.color;
    ctx.beginPath();
    ctx.arc(px, py, dp.radius * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};
