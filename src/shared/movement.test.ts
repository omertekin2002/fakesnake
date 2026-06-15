import { describe, expect, it } from 'vitest';
import {
  BOOST_MIN_LENGTH,
  BOOST_SPEED_MULTIPLIER,
  INITIAL_SNAKE_LENGTH,
  SEGMENT_DISTANCE,
  SNAKE_SPEED,
  TICK_RATE,
} from './constants';
import {
  canSnakeBoost,
  getSnakeSpeed,
  getTargetLength,
  rotateVelocityToward,
} from './movement';

const angleOf = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);
const isUnit = (v: { x: number; y: number }) =>
  Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9;

describe('constants', () => {
  it('keeps SEGMENT_DISTANCE consistent with speed / tick rate', () => {
    expect(SEGMENT_DISTANCE).toBeCloseTo(SNAKE_SPEED / TICK_RATE, 9);
  });
});

describe('rotateVelocityToward', () => {
  it('snaps exactly to the target when it is within maxTurn', () => {
    const target = { x: Math.cos(0.05), y: Math.sin(0.05) };
    const result = rotateVelocityToward({ x: 1, y: 0 }, target, 0.1);
    expect(result.x).toBe(target.x);
    expect(result.y).toBe(target.y);
  });

  it('rotates by at most maxTurn toward the target', () => {
    const result = rotateVelocityToward({ x: 1, y: 0 }, { x: 0, y: 1 }, 0.1);
    expect(angleOf(result)).toBeCloseTo(0.1, 9);
    expect(isUnit(result)).toBe(true);
  });

  it('turns the short way around the +/-PI wrap', () => {
    // From ~+PI to ~-PI the short path crosses PI (increasing angle), not a
    // near-full reverse rotation.
    const from = { x: Math.cos(3.0), y: Math.sin(3.0) };
    const to = { x: Math.cos(-3.0), y: Math.sin(-3.0) };
    const result = rotateVelocityToward(from, to, 0.1);
    expect(angleOf(result)).toBeCloseTo(3.1, 9);
  });

  it('clamps a 180-degree turn to maxTurn', () => {
    const result = rotateVelocityToward({ x: 1, y: 0 }, { x: -1, y: 0 }, 0.2);
    expect(Math.abs(angleOf(result))).toBeCloseTo(0.2, 9);
    expect(isUnit(result)).toBe(true);
  });
});

describe('getSnakeSpeed', () => {
  it('applies the boost multiplier only when boosting', () => {
    expect(getSnakeSpeed(false)).toBe(SNAKE_SPEED);
    expect(getSnakeSpeed(true)).toBe(SNAKE_SPEED * BOOST_SPEED_MULTIPLIER);
  });
});

describe('canSnakeBoost', () => {
  it('requires boost intent and length above the minimum', () => {
    expect(canSnakeBoost(true, BOOST_MIN_LENGTH + 1)).toBe(true);
    expect(canSnakeBoost(true, BOOST_MIN_LENGTH)).toBe(false); // strictly greater
    expect(canSnakeBoost(false, 100)).toBe(false);
  });
});

describe('getTargetLength', () => {
  it('grows two segments per point, floored', () => {
    expect(getTargetLength(0)).toBe(INITIAL_SNAKE_LENGTH);
    expect(getTargetLength(10)).toBe(INITIAL_SNAKE_LENGTH + 20);
    expect(getTargetLength(2.5)).toBe(INITIAL_SNAKE_LENGTH + 5);
  });
});
