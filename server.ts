import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Player, Food, GameState, Vector2, DeltaUpdate, WorldSummary } from './src/shared/types.js';
import {
  createRandomSnakeAppearance,
  getSnakePalette,
  normalizeSnakeAppearance,
} from './src/shared/skins.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const TICK_RATE = 30; // 30 updates per second
const WORLD_SIZE = 3000;
const INITIAL_SNAKE_LENGTH = 50;
const SNAKE_SPEED = 200; // pixels per second
const TURN_SPEED = 5; // radians per second
const FOOD_COUNT = 500;
const FOOD_SPAWN_RATE = 10; // per second
const SEGMENT_DISTANCE = 200 / 30; // SNAKE_SPEED / TICK_RATE
const SPATIAL_CELL_SIZE = 50;
const BOOST_SPEED_MULTIPLIER = 2;
const BOOST_MIN_LENGTH = 10;
const AOI_RADIUS = 1200;
const AOI_RADIUS_SQ = AOI_RADIUS * AOI_RADIUS;
const TARGET_PLAYER_COUNT = 8;
const BOT_PREFIX = 'bot_';
const BOT_FOOD_SEARCH_RADIUS = 250;
const BOT_WALL_MARGIN = 200;
const BOT_SPAWN_MARGIN = 350;
const BOT_SPAWN_HEAD_SAFE_RADIUS = 900;
const BOT_SPAWN_SEGMENT_SAFE_RADIUS = 260;
const BOT_SPAWN_VIEWPORT_MARGIN = 120;
const BOT_SPAWN_ATTEMPTS = 80;
const HUMAN_SPAWN_MARGIN = 420;
const HUMAN_SPAWN_HEAD_SAFE_RADIUS = 1000;
const HUMAN_SPAWN_SEGMENT_SAFE_RADIUS = 320;
const HUMAN_SPAWN_ATTEMPTS = 120;
const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 240;
const MAX_VIEWPORT_WIDTH = 2560;
const MAX_VIEWPORT_HEIGHT = 1440;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const FIXED_DT = 1 / TICK_RATE;
const MAX_ACCUMULATED_TIME = 0.25;
const SPAWN_PROTECTION_MS = 2500;
const MAX_DEATH_FOOD = 100;
const INPUT_RATE_LIMIT_MS = 16; // ~60/sec max (client sends at 30Hz)
const VIEWPORT_RATE_LIMIT_MS = 200; // 5/sec max
const BOT_NAMES = [
  'Slinky', 'Noodle', 'Zigzag', 'Slithers', 'Hissy',
  'Coil', 'Viper', 'Fang', 'Scales', 'Twisty',
  'Pretzel', 'Wriggles', 'Danger Noodle', 'Spaghetti', 'Sneky',
];

let botIdCounter = 0;

const isBot = (id: string) => id.startsWith(BOT_PREFIX);

type ViewportSize = { width: number; height: number };
type SpawnCandidate = { startPos: Vector2; startDir: Vector2; segments: Vector2[] };

const distanceSq = (a: Vector2, b: Vector2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const clampViewportDimension = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const normalizeViewport = (value: unknown): ViewportSize => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_VIEWPORT };
  }

  const maybeViewport = value as { width?: unknown; height?: unknown };
  return {
    width: clampViewportDimension(
      maybeViewport.width,
      MIN_VIEWPORT_WIDTH,
      MAX_VIEWPORT_WIDTH,
      DEFAULT_VIEWPORT.width,
    ),
    height: clampViewportDimension(
      maybeViewport.height,
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
      DEFAULT_VIEWPORT.height,
    ),
  };
};

const buildInitialSegments = (startPos: Vector2, startDir: Vector2): Vector2[] => {
  const segments: Vector2[] = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    segments.push({
      x: startPos.x - startDir.x * i * SEGMENT_DISTANCE,
      y: startPos.y - startDir.y * i * SEGMENT_DISTANCE,
    });
  }
  return segments;
};

const randomSpawnPosition = (margin = 0): Vector2 => ({
  x: margin + Math.random() * (WORLD_SIZE - margin * 2),
  y: margin + Math.random() * (WORLD_SIZE - margin * 2),
});

const createSpawnCandidate = (margin: number): SpawnCandidate => {
  const startPos = randomSpawnPosition(margin);
  const angle = Math.random() * Math.PI * 2;
  const startDir = { x: Math.cos(angle), y: Math.sin(angle) };
  return {
    startPos,
    startDir,
    segments: buildInitialSegments(startPos, startDir),
  };
};

const isPointInsideViewport = (point: Vector2, head: Vector2, viewport: ViewportSize): boolean => {
  const halfWidth = viewport.width / 2 + BOT_SPAWN_VIEWPORT_MARGIN;
  const halfHeight = viewport.height / 2 + BOT_SPAWN_VIEWPORT_MARGIN;

  return (
    point.x >= head.x - halfWidth &&
    point.x <= head.x + halfWidth &&
    point.y >= head.y - halfHeight &&
    point.y <= head.y + halfHeight
  );
};

const scoreBotSpawnCandidate = (segments: Vector2[]): number => {
  const botHead = segments[0];
  let minDistSq = Infinity;
  let viewportPenalty = 0;

  for (const [playerId, player] of players) {
    if (player.isDead || isBot(playerId)) continue;

    const viewport = playerViewports.get(playerId) ?? DEFAULT_VIEWPORT;
    if (isPointInsideViewport(botHead, player.segments[0], viewport)) {
      viewportPenalty += 100;
    }

    minDistSq = Math.min(minDistSq, distanceSq(botHead, player.segments[0]));

    for (let i = 0; i < player.segments.length; i += 5) {
      minDistSq = Math.min(minDistSq, distanceSq(botHead, player.segments[i]));
    }

    for (let i = 0; i < segments.length; i += 5) {
      if (isPointInsideViewport(segments[i], player.segments[0], viewport)) {
        viewportPenalty += 10;
      }
      minDistSq = Math.min(minDistSq, distanceSq(segments[i], player.segments[0]));
    }
  }

  return minDistSq - viewportPenalty * WORLD_SIZE * WORLD_SIZE;
};

const isBotSpawnSafe = (segments: Vector2[]): boolean => {
  const headRadiusSq = BOT_SPAWN_HEAD_SAFE_RADIUS * BOT_SPAWN_HEAD_SAFE_RADIUS;
  const segmentRadiusSq = BOT_SPAWN_SEGMENT_SAFE_RADIUS * BOT_SPAWN_SEGMENT_SAFE_RADIUS;
  const botHead = segments[0];

  for (const [playerId, player] of players) {
    if (player.isDead || isBot(playerId)) continue;

    const viewport = playerViewports.get(playerId) ?? DEFAULT_VIEWPORT;

    if (distanceSq(botHead, player.segments[0]) < headRadiusSq) {
      return false;
    }

    if (isPointInsideViewport(botHead, player.segments[0], viewport)) {
      return false;
    }

    for (let i = 0; i < player.segments.length; i += 5) {
      if (distanceSq(botHead, player.segments[i]) < segmentRadiusSq) {
        return false;
      }
    }

    for (let i = 0; i < segments.length; i += 5) {
      if (isPointInsideViewport(segments[i], player.segments[0], viewport)) {
        return false;
      }
      if (distanceSq(segments[i], player.segments[0]) < segmentRadiusSq) {
        return false;
      }
    }
  }

  return true;
};

const pickBotSpawn = (): { startPos: Vector2; startDir: Vector2; segments: Vector2[] } => {
  let bestCandidate: SpawnCandidate | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < BOT_SPAWN_ATTEMPTS; attempt++) {
    const candidate = createSpawnCandidate(BOT_SPAWN_MARGIN);
    const { segments } = candidate;

    if (isBotSpawnSafe(segments)) {
      return candidate;
    }

    const score = scoreBotSpawnCandidate(segments);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  return createSpawnCandidate(BOT_SPAWN_MARGIN);
};

const scoreHumanSpawnCandidate = (segments: Vector2[]): number => {
  const head = segments[0];
  let minDistSq = Infinity;
  let viewportPenalty = 0;

  for (const [playerId, player] of players) {
    if (player.isDead) continue;

    minDistSq = Math.min(minDistSq, distanceSq(head, player.segments[0]));

    for (let i = 0; i < player.segments.length; i += 5) {
      minDistSq = Math.min(minDistSq, distanceSq(head, player.segments[i]));
    }

    if (!isBot(playerId)) {
      const viewport = playerViewports.get(playerId) ?? DEFAULT_VIEWPORT;
      if (isPointInsideViewport(head, player.segments[0], viewport)) {
        viewportPenalty += 100;
      }
      for (let i = 0; i < segments.length; i += 5) {
        if (isPointInsideViewport(segments[i], player.segments[0], viewport)) {
          viewportPenalty += 10;
        }
      }
    }
  }

  return minDistSq - viewportPenalty * WORLD_SIZE * WORLD_SIZE;
};

const isHumanSpawnSafe = (segments: Vector2[]): boolean => {
  const headRadiusSq = HUMAN_SPAWN_HEAD_SAFE_RADIUS * HUMAN_SPAWN_HEAD_SAFE_RADIUS;
  const segmentRadiusSq = HUMAN_SPAWN_SEGMENT_SAFE_RADIUS * HUMAN_SPAWN_SEGMENT_SAFE_RADIUS;
  const head = segments[0];

  for (const [playerId, player] of players) {
    if (player.isDead) continue;

    if (distanceSq(head, player.segments[0]) < headRadiusSq) {
      return false;
    }

    for (let i = 0; i < player.segments.length; i += 5) {
      if (distanceSq(head, player.segments[i]) < segmentRadiusSq) {
        return false;
      }
    }

    for (let i = 0; i < segments.length; i += 5) {
      if (distanceSq(segments[i], player.segments[0]) < segmentRadiusSq) {
        return false;
      }
    }

    if (!isBot(playerId)) {
      const viewport = playerViewports.get(playerId) ?? DEFAULT_VIEWPORT;
      if (isPointInsideViewport(head, player.segments[0], viewport)) {
        return false;
      }
      for (let i = 0; i < segments.length; i += 5) {
        if (isPointInsideViewport(segments[i], player.segments[0], viewport)) {
          return false;
        }
      }
    }
  }

  return true;
};

const pickHumanSpawn = (): SpawnCandidate => {
  let bestCandidate: SpawnCandidate | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < HUMAN_SPAWN_ATTEMPTS; attempt++) {
    const candidate = createSpawnCandidate(HUMAN_SPAWN_MARGIN);
    if (isHumanSpawnSafe(candidate.segments)) {
      return candidate;
    }

    const score = scoreHumanSpawnCandidate(candidate.segments);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  return createSpawnCandidate(HUMAN_SPAWN_MARGIN);
};

const spawnBot = (): Player => {
  const id = `${BOT_PREFIX}${botIdCounter++}`;
  const { startDir, segments } = pickBotSpawn();
  const appearance = createRandomSnakeAppearance();

  return {
    id,
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    hue: getSnakePalette(appearance.paletteId).foodHue,
    appearance,
    segments,
    velocity: startDir,
    targetDirection: startDir,
    score: 0,
    isDead: false,
    isBoosting: false,
  };
};

const updateBotAI = (player: Player): void => {
  const head = player.segments[0];

  // Avoid walls — steer toward center when near edges
  let steerX = 0, steerY = 0;
  if (head.x < BOT_WALL_MARGIN) steerX += 1;
  if (head.x > WORLD_SIZE - BOT_WALL_MARGIN) steerX -= 1;
  if (head.y < BOT_WALL_MARGIN) steerY += 1;
  if (head.y > WORLD_SIZE - BOT_WALL_MARGIN) steerY -= 1;

  if (steerX !== 0 || steerY !== 0) {
    const len = Math.sqrt(steerX * steerX + steerY * steerY);
    player.targetDirection = { x: steerX / len, y: steerY / len };
    return;
  }

  // Seek nearest food
  const nearby = foodGrid.query(head.x, head.y, BOT_FOOD_SEARCH_RADIUS);
  let bestFood: Food | null = null;
  let bestDistSq = Infinity;
  for (const entry of nearby) {
    const dx = entry.food.position.x - head.x;
    const dy = entry.food.position.y - head.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestFood = entry.food;
    }
  }

  if (bestFood) {
    const dx = bestFood.position.x - head.x;
    const dy = bestFood.position.y - head.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      player.targetDirection = { x: dx / len, y: dy / len };
    }
    return;
  }

  // Wander — occasionally pick a new random-ish direction
  if (Math.random() < 0.02) {
    const angle = Math.atan2(player.velocity.y, player.velocity.x) + (Math.random() - 0.5) * 1.5;
    player.targetDirection = { x: Math.cos(angle), y: Math.sin(angle) };
  }
};

// ── Spatial Hash Grid ────────────────────────────────────────────────
class SpatialGrid<T> {
  private cellSize: number;
  private cells: Map<string, T[]> = new Map();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(x: number, y: number, item: T): void {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const k = this.key(cx, cy);
    const bucket = this.cells.get(k);
    if (bucket) {
      bucket.push(item);
    } else {
      this.cells.set(k, [item]);
    }
  }

  query(x: number, y: number, radius: number): T[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    const result: T[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) {
          for (const item of bucket) {
            result.push(item);
          }
        }
      }
    }
    return result;
  }
}

type FoodEntry = { id: string; food: Food };
type SegmentEntry = { playerId: string; segmentIndex: number; segment: Vector2 };

const foodGrid = new SpatialGrid<FoodEntry>(SPATIAL_CELL_SIZE);
const segmentGrid = new SpatialGrid<SegmentEntry>(SPATIAL_CELL_SIZE);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

// ── Server-side state using Maps for faster iteration/deletion ──────
const players = new Map<string, Player>();
const foods = new Map<string, Food>();
const playerViewports = new Map<string, ViewportSize>();
const knownPlayerIdsBySocket = new Map<string, Set<string>>();
const knownFoodIdsBySocket = new Map<string, Set<string>>();
const spawnProtectionUntilByPlayerId = new Map<string, number>();

let foodIdCounter = 0;
let foodCount = 0; // O(1) counter instead of foods.size each tick

// Helper functions
const randomPosition = (): Vector2 => ({
  x: Math.random() * WORLD_SIZE,
  y: Math.random() * WORLD_SIZE,
});

const generateFoodId = () => `f${foodIdCounter++}`;

const randomHue = () => Math.floor(Math.random() * 360);

const isWithinAoi = (origin: Vector2, target: Vector2): boolean => {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  return dx * dx + dy * dy < AOI_RADIUS_SQ;
};

const isPlayerSpawnProtected = (playerId: string, now: number): boolean => {
  const protectedUntil = spawnProtectionUntilByPlayerId.get(playerId);
  if (!protectedUntil) {
    return false;
  }
  if (protectedUntil <= now) {
    spawnProtectionUntilByPlayerId.delete(playerId);
    return false;
  }
  return true;
};

const spawnFood = (count: number): Food[] => {
  const spawned: Food[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateFoodId();
    const food: Food = {
      id,
      position: randomPosition(),
      value: Math.floor(Math.random() * 5) + 1,
      hue: randomHue(),
    };
    foods.set(id, food);
    foodCount++;
    foodGrid.insert(food.position.x, food.position.y, { id, food });
    spawned.push(food);
  }
  return spawned;
};

const createWorldSummary = (): WorldSummary => ({
  players: Array.from(players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    appearance: player.appearance,
    position: { ...player.segments[0] },
    score: player.score,
  })),
  foodCount,
  worldSize: WORLD_SIZE,
});

const serializeStateForPlayer = (playerId: string): GameState => {
  const player = players.get(playerId);
  if (!player) {
    return {
      players: {},
      foods: {},
      worldSize: WORLD_SIZE,
    };
  }

  const head = player.segments[0];
  const visiblePlayers = Array.from(players.values()).filter((candidate) =>
    candidate.id === playerId || isWithinAoi(head, candidate.segments[0]),
  );
  const visibleFoods = foodGrid
    .query(head.x, head.y, AOI_RADIUS)
    .filter((entry) => foods.has(entry.id))
    .map((entry) => entry.food);

  return {
    players: Object.fromEntries(visiblePlayers.map((candidate) => [candidate.id, candidate])),
    foods: Object.fromEntries(visibleFoods.map((food) => [food.id, food])),
    worldSize: WORLD_SIZE,
  };
};

// Convert Maps to Records for serialization (used only on init)
const serializeState = (): GameState => ({
  players: Object.fromEntries(players),
  foods: Object.fromEntries(foods),
  worldSize: WORLD_SIZE,
});

// Initial food
spawnFood(FOOD_COUNT);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  playerViewports.set(socket.id, normalizeViewport(socket.handshake.auth?.viewport));

  const { startDir, segments } = pickHumanSpawn();

  const rawName = (socket.handshake.auth?.name || '').toString().trim().slice(0, 16);
  const playerName = rawName || `Player ${Math.floor(Math.random() * 1000)}`;
  const appearance = normalizeSnakeAppearance(socket.handshake.auth?.appearance);

  const newPlayer: Player = {
    id: socket.id,
    name: playerName,
    hue: getSnakePalette(appearance.paletteId).foodHue,
    appearance,
    segments,
    velocity: startDir,
    targetDirection: startDir,
    score: 0,
    isDead: false,
    isBoosting: false,
  };

  players.set(socket.id, newPlayer);
  spawnProtectionUntilByPlayerId.set(socket.id, Date.now() + SPAWN_PROTECTION_MS);

  const initialState = serializeStateForPlayer(socket.id);
  socket.emit('init', { id: socket.id, state: initialState, summary: createWorldSummary() });
  knownPlayerIdsBySocket.set(socket.id, new Set(Object.keys(initialState.players)));
  knownFoodIdsBySocket.set(socket.id, new Set(Object.keys(initialState.foods)));

  pendingNewPlayers.push(newPlayer);

  let lastInputTime = 0;
  let lastViewportTime = 0;

  socket.on('input', (data: { x: number; y: number; boost?: boolean }) => {
    const now = Date.now();
    if (now - lastInputTime < INPUT_RATE_LIMIT_MS) return;
    lastInputTime = now;

    const player = players.get(socket.id);
    if (player && !player.isDead) {
      if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
        const length = Math.sqrt(data.x ** 2 + data.y ** 2);
        if (length > 0) {
          player.targetDirection = {
            x: data.x / length,
            y: data.y / length,
          };
        }
      }
      player.isBoosting = !!data.boost;
    }
  });

  socket.on('viewport', (data: { width?: number; height?: number }) => {
    const now = Date.now();
    if (now - lastViewportTime < VIEWPORT_RATE_LIMIT_MS) return;
    lastViewportTime = now;

    playerViewports.set(socket.id, normalizeViewport(data));
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const disconnectedPlayer = players.get(socket.id);

    // Spawn food from the disconnected player's body (same as death),
    // so players can't disconnect to deny food to nearby attackers.
    if (disconnectedPlayer && !disconnectedPlayer.isDead) {
      let deathFoodSpawned = 0;
      for (let si = 0; si < disconnectedPlayer.segments.length && deathFoodSpawned < MAX_DEATH_FOOD; si += 2) {
        const seg = disconnectedPlayer.segments[si];
        const id = generateFoodId();
        const newFood: Food = {
          id,
          position: { ...seg },
          value: 3,
          hue: disconnectedPlayer.hue,
        };
        foods.set(id, newFood);
        foodCount++;
        foodGrid.insert(newFood.position.x, newFood.position.y, { id, food: newFood });
        pendingNewFoods.push(newFood);
        deathFoodSpawned++;
      }
    }

    players.delete(socket.id);
    playerViewports.delete(socket.id);
    knownPlayerIdsBySocket.delete(socket.id);
    knownFoodIdsBySocket.delete(socket.id);
    spawnProtectionUntilByPlayerId.delete(socket.id);
    pendingRemovedPlayerIds.push(socket.id);
  });
});

let pendingNewPlayers: Player[] = [];
let pendingRemovedPlayerIds: string[] = [];
let pendingNewFoods: Food[] = [];

let lastTime = Date.now();
let accumulatedTime = 0;
let foodGridAge = 0;
const FOOD_GRID_REBUILD_INTERVAL = 30; // full rebuild every ~1 second

const stepGame = (dt: number, delta: DeltaUpdate) => {
  const tickNow = Date.now();

  // ── Spawn bots to fill the world ──────────────────────────────────
  let aliveCount = 0;
  for (const p of players.values()) {
    if (!p.isDead) aliveCount++;
  }
  while (aliveCount < TARGET_PLAYER_COUNT) {
    const bot = spawnBot();
    players.set(bot.id, bot);
    delta.newPlayers.push(bot);
    aliveCount++;
  }

  // Maintain food count
  if (foodCount < FOOD_COUNT) {
    const spawned = spawnFood(Math.min(FOOD_SPAWN_RATE, FOOD_COUNT - foodCount));
    delta.newFoods.push(...spawned);
  }

  // ── Maintain food grid incrementally; full purge every ~1s ─────────
  foodGridAge++;
  if (foodGridAge >= FOOD_GRID_REBUILD_INTERVAL) {
    foodGrid.clear();
    for (const [foodId, food] of foods) {
      foodGrid.insert(food.position.x, food.position.y, { id: foodId, food });
    }
    foodGridAge = 0;
  }
  // New food from spawnFood() is already inserted by spawnFood() itself.
  // Death/boost food is inserted inline below where it's created.

  // ── Update bot AI ─────────────────────────────────────────────────
  for (const [playerId, player] of players) {
    if (player.isDead || !isBot(playerId)) continue;
    updateBotAI(player);
  }

  // ── Rebuild segment grid ──────────────────────────────────────────
  segmentGrid.clear();
  for (const [pid, p] of players) {
    if (p.isDead || isPlayerSpawnProtected(pid, tickNow)) continue;
    for (let i = 0; i < p.segments.length; i++) {
      segmentGrid.insert(p.segments[i].x, p.segments[i].y, {
        playerId: pid,
        segmentIndex: i,
        segment: p.segments[i],
      });
    }
  }

  // Update players
  const deadPlayerIds: string[] = [];

  for (const [playerId, player] of players) {
    if (player.isDead) continue;
    const isProtected = isPlayerSpawnProtected(playerId, tickNow);

    // Smoothly rotate velocity towards targetDirection
    const currentAngle = Math.atan2(player.velocity.y, player.velocity.x);
    const targetAngle = Math.atan2(player.targetDirection.y, player.targetDirection.x);
    
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    const maxTurn = TURN_SPEED * dt;
    if (Math.abs(angleDiff) <= maxTurn) {
      player.velocity = { ...player.targetDirection };
    } else {
      const newAngle = currentAngle + Math.sign(angleDiff) * maxTurn;
      player.velocity = {
        x: Math.cos(newAngle),
        y: Math.sin(newAngle),
      };
    }

    const head = player.segments[0];
    const canBoost = !isProtected && player.isBoosting && player.segments.length > BOOST_MIN_LENGTH;
    const speed = canBoost ? SNAKE_SPEED * BOOST_SPEED_MULTIPLIER : SNAKE_SPEED;

    const newHead = {
      x: head.x + player.velocity.x * speed * dt,
      y: head.y + player.velocity.y * speed * dt,
    };

    newHead.x = Math.max(0, Math.min(WORLD_SIZE, newHead.x));
    newHead.y = Math.max(0, Math.min(WORLD_SIZE, newHead.y));

    player.segments.unshift(newHead);

    // Insert the new head into the segment grid so that players processed
    // later in this tick collide against our updated position, not the stale
    // pre-move snapshot.
    if (!isProtected) {
      segmentGrid.insert(newHead.x, newHead.y, {
        playerId,
        segmentIndex: 0,
        segment: newHead,
      });
    }

    // Check food collision via spatial grid
    const nearbyFoods = foodGrid.query(newHead.x, newHead.y, 20);
    for (const entry of nearbyFoods) {
      if (!foods.has(entry.id)) continue; // already eaten this tick
      const dx = newHead.x - entry.food.position.x;
      const dy = newHead.y - entry.food.position.y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq < 400) {
        player.score += entry.food.value;
        foods.delete(entry.id);
        foodCount--;
        delta.removedFoodIds.push(entry.id);
      }
    }

    // Determine target length based on score
    const targetLength = INITIAL_SNAKE_LENGTH + Math.floor(player.score * 2);

    let tailsRemoved = 0;
    if (player.segments.length > targetLength) {
      player.segments.pop();
      tailsRemoved++;
    }

    // Boost: shed a tail segment as food each tick
    if (canBoost) {
      const shed = player.segments.pop()!;
      tailsRemoved++;
      player.score = Math.max(0, player.score - 1);

      const id = generateFoodId();
      const newFood: Food = {
        id,
        position: { ...shed },
        value: 1,
        hue: player.hue,
      };
      foods.set(id, newFood);
      foodCount++;
      foodGrid.insert(newFood.position.x, newFood.position.y, { id, food: newFood });
      delta.newFoods.push(newFood);
    }

    delta.playerUpdates[playerId] = {
      newHead,
      removeTail: tailsRemoved,
      score: player.score,
      velocity: { ...player.velocity },
    };

    // Check collision with other players and own body via spatial grid
    if (!isProtected) {
      const nearbySegments = segmentGrid.query(newHead.x, newHead.y, 15);
      for (const entry of nearbySegments) {
        if (entry.playerId === playerId) continue;
        const other = players.get(entry.playerId);
        if (!other || other.isDead) continue;

        const dx = newHead.x - entry.segment.x;
        const dy = newHead.y - entry.segment.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 225) {
          player.isDead = true;
          delta.removedPlayerIds.push(playerId);
          deadPlayerIds.push(playerId);
          delete delta.playerUpdates[playerId];
          spawnProtectionUntilByPlayerId.delete(playerId);

          // Tell the player who killed them
          if (!isBot(playerId)) {
            const killerName = other?.name || 'Unknown';
            io.to(playerId).emit('killed', { killerName });
          }
          
          // Spawn food where player died (capped to prevent food count explosions)
          let deathFoodSpawned = 0;
          for (let si = 0; si < player.segments.length && deathFoodSpawned < MAX_DEATH_FOOD; si += 2) {
            const seg = player.segments[si];
            const id = generateFoodId();
            const newFood: Food = {
              id,
              position: { ...seg },
              value: 3,
              hue: player.hue,
            };
            foods.set(id, newFood);
            foodCount++;
            foodGrid.insert(newFood.position.x, newFood.position.y, { id, food: newFood });
            delta.newFoods.push(newFood);
            deathFoodSpawned++;
          }
          break;
        }
      }
    }
  }

  // Remove dead players — delete from Map directly (no second pass needed)
  for (const id of deadPlayerIds) {
    players.delete(id);
    spawnProtectionUntilByPlayerId.delete(id);
  }
};

const emitDelta = (delta: DeltaUpdate) => {
  if (
    Object.keys(delta.playerUpdates).length === 0 &&
    delta.newPlayers.length === 0 &&
    delta.removedPlayerIds.length === 0 &&
    delta.newFoods.length === 0 &&
    delta.removedFoodIds.length === 0
  ) {
    return;
  }

  // ── Per-client viewport-culled deltas ───────────────────────────────
  for (const [socketId, socket] of io.sockets.sockets) {
    const player = players.get(socketId);
    const knownPlayerIds = knownPlayerIdsBySocket.get(socketId) ?? new Set<string>();
    const knownFoodIds = knownFoodIdsBySocket.get(socketId) ?? new Set<string>();
    knownPlayerIdsBySocket.set(socketId, knownPlayerIds);
    knownFoodIdsBySocket.set(socketId, knownFoodIds);

    if (!player) {
      // Dead or transitional — send full delta so client detects death
      for (const playerId of delta.newPlayers.map((entry) => entry.id)) knownPlayerIds.add(playerId);
      for (const food of delta.newFoods) knownFoodIds.add(food.id);
      for (const playerId of delta.removedPlayerIds) knownPlayerIds.delete(playerId);
      for (const foodId of delta.removedFoodIds) knownFoodIds.delete(foodId);
      socket.emit('delta', delta);
      continue;
    }

    const hx = player.segments[0].x;
    const hy = player.segments[0].y;
    const origin = { x: hx, y: hy };

    const outgoingNewPlayers: Player[] = [];
    const seenNewPlayerIds = new Set<string>();

    const enqueuePlayerIfUnknown = (candidate: Player | undefined) => {
      if (!candidate || knownPlayerIds.has(candidate.id) || seenNewPlayerIds.has(candidate.id)) {
        return;
      }
      outgoingNewPlayers.push(candidate);
      seenNewPlayerIds.add(candidate.id);
      knownPlayerIds.add(candidate.id);
    };

    // Filter playerUpdates by AOI (always include own update)
    let filteredUpdates = delta.playerUpdates;
    const updateKeys = Object.keys(delta.playerUpdates);
    if (updateKeys.length > 1) {
      filteredUpdates = {};
      for (const pid of updateKeys) {
        if (pid === socketId) {
          filteredUpdates[pid] = delta.playerUpdates[pid];
          enqueuePlayerIfUnknown(players.get(pid));
          continue;
        }
        const other = players.get(pid);
        if (!other) continue;
        if (isWithinAoi(origin, other.segments[0])) {
          filteredUpdates[pid] = delta.playerUpdates[pid];
          enqueuePlayerIfUnknown(other);
        }
      }
    } else if (updateKeys.length === 1) {
      enqueuePlayerIfUnknown(players.get(updateKeys[0]));
    }

    for (const candidate of delta.newPlayers) {
      if (candidate.id === socketId || isWithinAoi(origin, candidate.segments[0])) {
        enqueuePlayerIfUnknown(candidate);
      }
    }

    // Filter new foods by AOI and also reveal previously-unsent food when it becomes relevant.
    const outgoingNewFoods: Food[] = [];
    const seenNewFoodIds = new Set<string>();
    const enqueueFoodIfUnknown = (food: Food | undefined) => {
      if (!food || knownFoodIds.has(food.id) || seenNewFoodIds.has(food.id)) {
        return;
      }
      outgoingNewFoods.push(food);
      seenNewFoodIds.add(food.id);
      knownFoodIds.add(food.id);
    };

    for (const food of delta.newFoods) {
      if (isWithinAoi(origin, food.position)) {
        enqueueFoodIfUnknown(food);
      }
    }

    const nearbyFoods = foodGrid.query(hx, hy, AOI_RADIUS);
    for (const entry of nearbyFoods) {
      if (!foods.has(entry.id)) continue; // skip stale food grid entries
      enqueueFoodIfUnknown(entry.food);
    }

    const outgoingRemovedPlayerIds = delta.removedPlayerIds.filter((playerId) => {
      if (!knownPlayerIds.has(playerId)) {
        return false;
      }
      knownPlayerIds.delete(playerId);
      return true;
    });

    const outgoingRemovedFoodIds = delta.removedFoodIds.filter((foodId) => {
      if (!knownFoodIds.has(foodId)) {
        return false;
      }
      knownFoodIds.delete(foodId);
      return true;
    });

    socket.emit('delta', {
      playerUpdates: filteredUpdates,
      newPlayers: outgoingNewPlayers,
      removedPlayerIds: outgoingRemovedPlayerIds,
      newFoods: outgoingNewFoods,
      removedFoodIds: outgoingRemovedFoodIds,
      summary: delta.summary,
    });
  }
};

const updateGame = () => {
  const now = Date.now();
  const elapsed = Math.min((now - lastTime) / 1000, MAX_ACCUMULATED_TIME);
  lastTime = now;
  accumulatedTime += elapsed;

  if (accumulatedTime < FIXED_DT) {
    return;
  }

  const delta: DeltaUpdate = {
    playerUpdates: {},
    newPlayers: [...pendingNewPlayers],
    removedPlayerIds: [...pendingRemovedPlayerIds],
    newFoods: [...pendingNewFoods],
    removedFoodIds: [],
    summary: { players: [], foodCount: 0, worldSize: WORLD_SIZE },
  };

  pendingNewPlayers = [];
  pendingRemovedPlayerIds = [];
  pendingNewFoods = [];

  stepGame(FIXED_DT, delta);
  accumulatedTime -= FIXED_DT;
  // Cap so we never run more than one tick per delta — multiple ticks would
  // overwrite playerUpdates and desync client-side snake lengths.
  if (accumulatedTime > FIXED_DT) {
    accumulatedTime = 0;
  }

  delta.summary = createWorldSummary();

  emitDelta(delta);
};

setInterval(updateGame, 1000 / TICK_RATE);

async function startServer() {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
