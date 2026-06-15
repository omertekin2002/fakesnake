import { Vector2 } from '../shared/types';
import { FIXED_DT, TURN_SPEED } from '../shared/constants';
import {
  canSnakeBoost,
  getSnakeSpeed,
  getTargetLength,
  rotateVelocityToward,
} from '../shared/movement';

// ── Client-side prediction for the LOCAL snake ───────────────────────────────
// We simulate our own snake immediately from input using the exact server
// physics, so the head responds with zero network lag. Each authoritative delta
// re-bases the prediction (`reconcilePrediction`) and replays the inputs the
// server hasn't acknowledged yet. Remote snakes are NOT predicted — we can't see
// their input — so they keep the interpolation path in App.tsx.

export type PendingInput = {
  seq: number;
  dir: Vector2;
  boost: boolean;
};

export type PredictionState = {
  seq: number; // last input sequence number we generated
  pending: PendingInput[]; // inputs sent but not yet acknowledged by the server
  segments: Vector2[]; // predicted trail, newest (head) first — matches wire order
  velocity: Vector2;
  // Predicted score. Boosting drains it (server: -1/tick), which lowers the
  // target length, so tracking it locally keeps the predicted body length in
  // step with the server while boosting instead of snapping back on reconcile.
  score: number;
  // Client-clock (performance.now) timestamp when spawn protection ends. While
  // protected the server refuses boost speed, so prediction must not apply it.
  protectedUntil: number;
  initialized: boolean;
};

// Cap pending inputs (~4s at 30Hz). If the server stalls we stop extending the
// head rather than letting it run away into the distance.
const MAX_PENDING = 120;

export const createPredictionState = (): PredictionState => ({
  seq: 0,
  pending: [],
  segments: [],
  velocity: { x: 1, y: 0 },
  score: 0,
  protectedUntil: 0,
  initialized: false,
});

// Mutable target for one fixed-timestep step. PredictionState satisfies it, and
// reconcile builds a throwaway one from the authoritative state.
type StepTarget = { segments: Vector2[]; velocity: Vector2; score: number };

// One fixed-timestep movement step, mutating the target in place. This mirrors
// the server's Pass-1 movement EXACTLY (sans server-only collision/food): rotate,
// advance head, single length-maintenance pop, then — if boosting — shed one
// extra tail and drain a point of score (target length uses the pre-drain score).
const applyStep = (t: StepTarget, dir: Vector2, boost: boolean, protectedNow: boolean): void => {
  const next = rotateVelocityToward(t.velocity, dir, TURN_SPEED * FIXED_DT);
  t.velocity = next;

  // Boost gate uses the pre-push length, exactly like the server.
  const boosting = !protectedNow && canSnakeBoost(boost, t.segments.length);
  const speed = getSnakeSpeed(boosting);
  const head = t.segments[0];
  t.segments.unshift({
    x: head.x + next.x * speed * FIXED_DT,
    y: head.y + next.y * speed * FIXED_DT,
  });

  const targetLength = getTargetLength(t.score); // pre-drain score, like the server
  if (t.segments.length > targetLength) t.segments.pop();

  if (boosting) {
    if (t.segments.length > 0) t.segments.pop();
    t.score = Math.max(0, t.score - 1);
  }
};

// Seed the prediction from an authoritative snapshot (the `init` payload).
// `protectedUntil` is the client-clock time when spawn protection lapses.
export const seedPrediction = (
  pred: PredictionState,
  segments: Vector2[],
  velocity: Vector2,
  score: number,
  protectedUntil: number,
): void => {
  pred.segments = segments.map((seg) => ({ ...seg }));
  pred.velocity = { ...velocity };
  pred.score = score;
  pred.protectedUntil = protectedUntil;
  pred.pending = [];
  pred.initialized = true;
};

// Generate one local input, apply it optimistically, and return the sequence
// number to send to the server. `nowMs` is performance.now() at the tick.
export const predictInput = (
  pred: PredictionState,
  dir: Vector2,
  boost: boolean,
  nowMs: number,
): number => {
  const seq = ++pred.seq;

  // Before the first authoritative snapshot we still advance the counter and
  // send (so the server can ack it), but we have no trail to extend yet.
  if (!pred.initialized || pred.segments.length === 0) {
    return seq;
  }

  pred.pending.push({ seq, dir: { x: dir.x, y: dir.y }, boost });
  if (pred.pending.length > MAX_PENDING) {
    pred.pending.shift();
    return seq;
  }

  applyStep(pred, dir, boost, nowMs < pred.protectedUntil);
  return seq;
};

// Re-base the prediction on the authoritative state, then replay every input
// the server hasn't acknowledged. This is the source of truth; predictInput is
// just the optimistic extension between server updates. `score` is the
// authoritative score and `nowMs` is performance.now().
export const reconcilePrediction = (
  pred: PredictionState,
  authSegments: Vector2[],
  authVelocity: Vector2,
  ackSeq: number,
  score: number,
  nowMs: number,
): void => {
  pred.pending = pred.pending.filter((input) => input.seq > ackSeq);

  const target: StepTarget = {
    segments: authSegments.map((seg) => ({ ...seg })),
    velocity: { ...authVelocity },
    score,
  };
  const protectedNow = nowMs < pred.protectedUntil;

  for (const input of pred.pending) {
    applyStep(target, input.dir, input.boost, protectedNow);
  }

  pred.segments = target.segments;
  pred.velocity = target.velocity;
  pred.score = target.score;
  pred.initialized = true;
};
