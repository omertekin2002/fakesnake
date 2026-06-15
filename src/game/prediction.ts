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
  initialized: false,
});

// One fixed-timestep movement step, mutating `segments`/`velocity` in place.
// Identical to the server's Pass-1 movement (sans server-only collision/food).
const applyStep = (
  segments: Vector2[],
  velocity: Vector2,
  dir: Vector2,
  boost: boolean,
  targetLength: number,
): void => {
  const next = rotateVelocityToward(velocity, dir, TURN_SPEED * FIXED_DT);
  velocity.x = next.x;
  velocity.y = next.y;

  const head = segments[0];
  const speed = getSnakeSpeed(canSnakeBoost(boost, segments.length));
  segments.unshift({
    x: head.x + velocity.x * speed * FIXED_DT,
    y: head.y + velocity.y * speed * FIXED_DT,
  });

  while (segments.length > targetLength) segments.pop();
};

// Seed the prediction from an authoritative snapshot (the `init` payload).
export const seedPrediction = (
  pred: PredictionState,
  segments: Vector2[],
  velocity: Vector2,
): void => {
  pred.segments = segments.map((seg) => ({ ...seg }));
  pred.velocity = { ...velocity };
  pred.pending = [];
  pred.initialized = true;
};

// Generate one local input, apply it optimistically, and return the sequence
// number to send to the server. Called at the fixed tick rate from App.tsx.
export const predictInput = (
  pred: PredictionState,
  dir: Vector2,
  boost: boolean,
  score: number,
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

  applyStep(pred.segments, pred.velocity, dir, boost, getTargetLength(score));
  return seq;
};

// Re-base the prediction on the authoritative state, then replay every input
// the server hasn't acknowledged. This is the source of truth; predictInput is
// just the optimistic extension between server updates.
export const reconcilePrediction = (
  pred: PredictionState,
  authSegments: Vector2[],
  authVelocity: Vector2,
  ackSeq: number,
  score: number,
): void => {
  pred.pending = pred.pending.filter((input) => input.seq > ackSeq);

  const segments = authSegments.map((seg) => ({ ...seg }));
  const velocity = { ...authVelocity };
  const targetLength = getTargetLength(score);

  for (const input of pred.pending) {
    applyStep(segments, velocity, input.dir, input.boost, targetLength);
  }

  pred.segments = segments;
  pred.velocity = velocity;
  pred.initialized = true;
};
