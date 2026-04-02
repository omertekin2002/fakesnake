import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { Player, Food, GameState, Vector2, DeltaUpdate } from './src/shared/types.js';

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
const BOT_NAMES = [
  'Slinky', 'Noodle', 'Zigzag', 'Slithers', 'Hissy',
  'Coil', 'Viper', 'Fang', 'Scales', 'Twisty',
  'Pretzel', 'Wriggles', 'Danger Noodle', 'Spaghetti', 'Sneky',
];

let botIdCounter = 0;

const isBot = (id: string) => id.startsWith(BOT_PREFIX);

const spawnBot = (): Player => {
  const id = `${BOT_PREFIX}${botIdCounter++}`;
  const startPos = randomPosition();
  const angle = Math.random() * Math.PI * 2;
  const startDir = { x: Math.cos(angle), y: Math.sin(angle) };
  const segments: Vector2[] = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    segments.push({
      x: startPos.x - startDir.x * i * SEGMENT_DISTANCE,
      y: startPos.y - startDir.y * i * SEGMENT_DISTANCE,
    });
  }

  return {
    id,
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    hue: randomHue(),
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

let foodIdCounter = 0;
let foodCount = 0; // O(1) counter instead of foods.size each tick

// Helper functions
const randomPosition = (): Vector2 => ({
  x: Math.random() * WORLD_SIZE,
  y: Math.random() * WORLD_SIZE,
});

const generateFoodId = () => `f${foodIdCounter++}`;

const randomHue = () => Math.floor(Math.random() * 360);

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

  const startPos = randomPosition();
  const startDir = { x: 1, y: 0 };
  const segments: Vector2[] = [];
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
    segments.push({
      x: startPos.x - i * SEGMENT_DISTANCE,
      y: startPos.y,
    });
  }

  const rawName = (socket.handshake.auth?.name || '').toString().trim().slice(0, 16);
  const playerName = rawName || `Player ${Math.floor(Math.random() * 1000)}`;

  const newPlayer: Player = {
    id: socket.id,
    name: playerName,
    hue: randomHue(),
    segments,
    velocity: startDir,
    targetDirection: startDir,
    score: 0,
    isDead: false,
    isBoosting: false,
  };

  players.set(socket.id, newPlayer);

  // Full state snapshot for the new client (converted from Maps → Records)
  socket.emit('init', { id: socket.id, state: serializeState() });

  pendingNewPlayers.push(newPlayer);

  socket.on('input', (data: { x: number; y: number; boost?: boolean }) => {
    const player = players.get(socket.id);
    if (player && !player.isDead) {
      const length = Math.sqrt(data.x ** 2 + data.y ** 2);
      if (length > 0) {
        player.targetDirection = {
          x: data.x / length,
          y: data.y / length,
        };
      }
      player.isBoosting = !!data.boost;
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    players.delete(socket.id);
    pendingRemovedPlayerIds.push(socket.id);
  });
});

let pendingNewPlayers: Player[] = [];
let pendingRemovedPlayerIds: string[] = [];

let lastTime = Date.now();
let foodGridAge = 0;
const FOOD_GRID_REBUILD_INTERVAL = 30; // full rebuild every ~1 second

const updateGame = () => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  const delta: DeltaUpdate = {
    playerUpdates: {},
    newPlayers: [...pendingNewPlayers],
    removedPlayerIds: [...pendingRemovedPlayerIds],
    newFoods: [],
    removedFoodIds: [],
  };

  pendingNewPlayers = [];
  pendingRemovedPlayerIds = [];

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
    if (p.isDead) continue;
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
    const canBoost = player.isBoosting && player.segments.length > BOOST_MIN_LENGTH;
    const speed = canBoost ? SNAKE_SPEED * BOOST_SPEED_MULTIPLIER : SNAKE_SPEED;

    const newHead = {
      x: head.x + player.velocity.x * speed * dt,
      y: head.y + player.velocity.y * speed * dt,
    };

    newHead.x = Math.max(0, Math.min(WORLD_SIZE, newHead.x));
    newHead.y = Math.max(0, Math.min(WORLD_SIZE, newHead.y));

    player.segments.unshift(newHead);

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
    const SELF_SKIP_SEGMENTS = 20;
    const nearbySegments = segmentGrid.query(newHead.x, newHead.y, 15);
    for (const entry of nearbySegments) {
      // Skip nearby neck segments for self-collision (head is always touching them)
      if (entry.playerId === playerId && entry.segmentIndex < SELF_SKIP_SEGMENTS) continue;
      const other = entry.playerId === playerId ? player : players.get(entry.playerId);
      if (!other || other.isDead) continue;

      const dx = newHead.x - entry.segment.x;
      const dy = newHead.y - entry.segment.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < 225) {
        player.isDead = true;
        delta.removedPlayerIds.push(playerId);
        deadPlayerIds.push(playerId);
        delete delta.playerUpdates[playerId];

        // Tell the player who killed them
        if (!isBot(playerId)) {
          const killerName = entry.playerId === playerId ? 'yourself' : (other?.name || 'Unknown');
          io.to(playerId).emit('killed', { killerName });
        }
        
        // Spawn food where player died
        player.segments.forEach((seg, index) => {
          if (index % 2 === 0) {
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
          }
        });
        break;
      }
    }
  }

  // Remove dead players — delete from Map directly (no second pass needed)
  for (const id of deadPlayerIds) {
    players.delete(id);
  }

  // ── Per-client viewport-culled deltas ───────────────────────────────
  for (const [socketId, socket] of io.sockets.sockets) {
    const player = players.get(socketId);

    if (!player) {
      // Dead or transitional — send full delta so client detects death
      socket.emit('delta', delta);
      continue;
    }

    const hx = player.segments[0].x;
    const hy = player.segments[0].y;

    // Filter playerUpdates by AOI (always include own update)
    let filteredUpdates = delta.playerUpdates;
    const updateKeys = Object.keys(delta.playerUpdates);
    if (updateKeys.length > 1) {
      filteredUpdates = {};
      for (const pid of updateKeys) {
        if (pid === socketId) {
          filteredUpdates[pid] = delta.playerUpdates[pid];
          continue;
        }
        const other = players.get(pid);
        if (!other) continue;
        const dx = other.segments[0].x - hx;
        const dy = other.segments[0].y - hy;
        if (dx * dx + dy * dy < AOI_RADIUS_SQ) {
          filteredUpdates[pid] = delta.playerUpdates[pid];
        }
      }
    }

    // Filter newFoods by AOI
    let filteredNewFoods = delta.newFoods;
    if (delta.newFoods.length > 0) {
      filteredNewFoods = delta.newFoods.filter((food) => {
        const dx = food.position.x - hx;
        const dy = food.position.y - hy;
        return dx * dx + dy * dy < AOI_RADIUS_SQ;
      });
    }

    if (filteredUpdates === delta.playerUpdates && filteredNewFoods === delta.newFoods) {
      socket.emit('delta', delta);
    } else {
      socket.emit('delta', {
        playerUpdates: filteredUpdates,
        newPlayers: delta.newPlayers,
        removedPlayerIds: delta.removedPlayerIds,
        newFoods: filteredNewFoods,
        removedFoodIds: delta.removedFoodIds,
      });
    }
  }
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
