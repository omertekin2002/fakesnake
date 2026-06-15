import { Vector2 } from './types';
import {
  BOOST_MIN_LENGTH,
  BOOST_SPEED_MULTIPLIER,
  INITIAL_SNAKE_LENGTH,
  SNAKE_SPEED,
} from './constants';

// Pure movement helpers shared by the server simulation and the client
// prediction. The math here MUST match on both sides — any divergence shows up
// as the predicted snake drifting from the authoritative one.

// Rotate `velocity` toward `targetDirection`, capped at `maxTurn` radians.
// Returns a fresh unit vector; if the target is within reach this snaps exactly
// to the (already normalized) target direction, mirroring the server.
export const rotateVelocityToward = (
  velocity: Vector2,
  targetDirection: Vector2,
  maxTurn: number,
): Vector2 => {
  const currentAngle = Math.atan2(velocity.y, velocity.x);
  const targetAngle = Math.atan2(targetDirection.y, targetDirection.x);

  let angleDiff = targetAngle - currentAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  if (Math.abs(angleDiff) <= maxTurn) {
    return { x: targetDirection.x, y: targetDirection.y };
  }

  const newAngle = currentAngle + Math.sign(angleDiff) * maxTurn;
  return { x: Math.cos(newAngle), y: Math.sin(newAngle) };
};

export const canSnakeBoost = (isBoosting: boolean, length: number): boolean =>
  isBoosting && length > BOOST_MIN_LENGTH;

export const getSnakeSpeed = (boosting: boolean): number =>
  boosting ? SNAKE_SPEED * BOOST_SPEED_MULTIPLIER : SNAKE_SPEED;

export const getTargetLength = (score: number): number =>
  INITIAL_SNAKE_LENGTH + Math.floor(score * 2);
