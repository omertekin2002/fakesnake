// Physics constants shared between the authoritative server (server.ts) and the
// client-side prediction (src/game/prediction.ts). Keeping a single source of
// truth guarantees the client simulates movement identically to the server, so
// predicted and authoritative positions reconcile cleanly.

export const TICK_RATE = 30; // simulation ticks per second
export const FIXED_DT = 1 / TICK_RATE;
export const WORLD_SIZE = 3000;
export const INITIAL_SNAKE_LENGTH = 50;
export const SNAKE_SPEED = 200; // pixels per second
export const TURN_SPEED = 5; // radians per second
export const SEGMENT_DISTANCE = SNAKE_SPEED / TICK_RATE;
export const BOOST_SPEED_MULTIPLIER = 2;
export const BOOST_MIN_LENGTH = 10;
