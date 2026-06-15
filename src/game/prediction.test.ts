import { describe, expect, it } from 'vitest';
import { FIXED_DT, SEGMENT_DISTANCE, SNAKE_SPEED } from '../shared/constants';
import { Vector2 } from '../shared/types';
import {
  createPredictionState,
  predictInput,
  reconcilePrediction,
  seedPrediction,
} from './prediction';

// A fixed "now" comfortably past protectedUntil=0, so tests are unprotected
// unless they opt in by seeding a future protectedUntil.
const NOW = 1000;

// A straight snake of `len` segments, head at `head`, trailing along -dir.
const makeSnake = (
  len: number,
  head: Vector2 = { x: 1000, y: 1000 },
  dir: Vector2 = { x: 1, y: 0 },
): Vector2[] =>
  Array.from({ length: len }, (_, i) => ({
    x: head.x - dir.x * i * SEGMENT_DISTANCE,
    y: head.y - dir.y * i * SEGMENT_DISTANCE,
  }));

// A turning sequence of inputs to exercise rotation + boost.
const INPUTS = Array.from({ length: 12 }, (_, i) => ({
  dir: { x: Math.cos(i * 0.15), y: Math.sin(i * 0.15) },
  boost: i % 3 === 0,
}));

const applyInputs = (
  segments: Vector2[],
  velocity: Vector2,
  count = INPUTS.length,
  score = 0,
) => {
  const pred = createPredictionState();
  seedPrediction(pred, segments, velocity, score, 0);
  for (let i = 0; i < count; i++) {
    predictInput(pred, INPUTS[i].dir, INPUTS[i].boost, NOW);
  }
  return pred;
};

describe('prediction state', () => {
  it('starts uninitialized and does not extend before seeding', () => {
    const pred = createPredictionState();
    expect(pred.initialized).toBe(false);

    const seq = predictInput(pred, { x: 1, y: 0 }, false, NOW);
    expect(seq).toBe(1); // sequence still advances so the server can ack it
    expect(pred.segments).toHaveLength(0);
    expect(pred.pending).toHaveLength(0);
  });

  it('seedPrediction copies (does not alias) the authoritative arrays', () => {
    const segments = makeSnake(50);
    const velocity = { x: 1, y: 0 };
    const pred = createPredictionState();
    seedPrediction(pred, segments, velocity, 0, 0);

    expect(pred.initialized).toBe(true);
    expect(pred.segments).not.toBe(segments);
    expect(pred.segments[0]).not.toBe(segments[0]);
    pred.velocity.x = 999;
    expect(velocity.x).toBe(1);
  });

  it('predictInput advances the head in the input direction', () => {
    const pred = createPredictionState();
    seedPrediction(pred, makeSnake(50), { x: 1, y: 0 }, 0, 0);
    const before = { ...pred.segments[0] };
    predictInput(pred, { x: 1, y: 0 }, false, NOW);
    expect(pred.segments[0].x).toBeGreaterThan(before.x);
    expect(pred.pending).toHaveLength(1);
  });
});

describe('boost prediction (mirrors server)', () => {
  it('drains predicted score and sheds tail while boosting', () => {
    const pred = createPredictionState();
    // score 5 -> target length 60; start at equilibrium length.
    seedPrediction(pred, makeSnake(60), { x: 1, y: 0 }, 5, 0);
    for (let i = 0; i < 3; i++) predictInput(pred, { x: 1, y: 0 }, true, NOW);
    expect(pred.score).toBe(2); // -1 per boosting tick
    expect(pred.segments.length).toBeLessThan(60); // tail shed while boosting
  });

  it('does not apply boost speed (or drain score) while spawn-protected', () => {
    const pred = createPredictionState();
    seedPrediction(pred, makeSnake(60), { x: 1, y: 0 }, 5, 1e9); // protected far ahead
    const beforeX = pred.segments[0].x;
    predictInput(pred, { x: 1, y: 0 }, true, NOW); // NOW < protectedUntil → protected
    expect(pred.score).toBe(5); // no drain while protected
    expect(pred.segments[0].x - beforeX).toBeCloseTo(SNAKE_SPEED * FIXED_DT, 6); // 1x speed
  });
});

describe('reconciliation', () => {
  it('is deterministic for identical input streams', () => {
    const a = applyInputs(makeSnake(50), { x: 1, y: 0 });
    const b = applyInputs(makeSnake(50), { x: 1, y: 0 });
    expect(b.segments[0].x).toBeCloseTo(a.segments[0].x, 9);
    expect(b.segments[0].y).toBeCloseTo(a.segments[0].y, 9);
  });

  it('predict-then-reconcile converges to uninterrupted prediction', () => {
    const seedSegments = makeSnake(50);
    const seedVelocity = { x: 1, y: 0 };
    const ACK = 5; // server has applied the first 5 inputs

    // Ground truth: uninterrupted client prediction of the whole stream.
    const continuous = applyInputs(seedSegments, seedVelocity);

    // What the server reports after applying the first ACK inputs (same physics).
    const server = applyInputs(seedSegments, seedVelocity, ACK);

    // Client predicted the whole stream, then reconciles against the server.
    const reconciled = applyInputs(seedSegments, seedVelocity);
    reconcilePrediction(reconciled, server.segments, server.velocity, ACK, 0, NOW);

    // Acked inputs dropped; the rest replayed onto the authoritative base.
    expect(reconciled.pending.every((p) => p.seq > ACK)).toBe(true);
    expect(reconciled.pending).toHaveLength(INPUTS.length - ACK);

    // Head (and body) must land exactly where uninterrupted prediction did.
    expect(reconciled.segments).toHaveLength(continuous.segments.length);
    for (let i = 0; i < continuous.segments.length; i += 10) {
      expect(reconciled.segments[i].x).toBeCloseTo(continuous.segments[i].x, 6);
      expect(reconciled.segments[i].y).toBeCloseTo(continuous.segments[i].y, 6);
    }
  });

  it('drops every pending input once the server catches up', () => {
    const reconciled = applyInputs(makeSnake(50), { x: 1, y: 0 });
    const server = applyInputs(makeSnake(50), { x: 1, y: 0 });
    reconcilePrediction(reconciled, server.segments, server.velocity, INPUTS.length, 0, NOW);
    expect(reconciled.pending).toHaveLength(0);
  });
});
