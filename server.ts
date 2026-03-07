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

  const newPlayer: Player = {
    id: socket.id,
    name: `Player ${Math.floor(Math.random() * 1000)}`,
    hue: randomHue(),
    segments,
    velocity: startDir,
    targetDirection: startDir,
    score: 0,
    isDead: false,
  };

  players.set(socket.id, newPlayer);

  // Full state snapshot for the new client (converted from Maps → Records)
  socket.emit('init', { id: socket.id, state: serializeState() });

  pendingNewPlayers.push(newPlayer);

  socket.on('input', (targetDirection: Vector2) => {
    const player = players.get(socket.id);
    if (player && !player.isDead) {
      const length = Math.sqrt(targetDirection.x ** 2 + targetDirection.y ** 2);
      if (length > 0) {
        player.targetDirection = {
          x: targetDirection.x / length,
          y: targetDirection.y / length,
        };
      }
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

  // Maintain food count
  if (foodCount < FOOD_COUNT) {
    const spawned = spawnFood(Math.min(FOOD_SPAWN_RATE, FOOD_COUNT - foodCount));
    delta.newFoods.push(...spawned);
  }

  // ── Rebuild spatial grids ──────────────────────────────────────────
  foodGrid.clear();
  for (const [foodId, food] of foods) {
    foodGrid.insert(food.position.x, food.position.y, { id: foodId, food });
  }

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
    
    const newHead = {
      x: head.x + player.velocity.x * SNAKE_SPEED * dt,
      y: head.y + player.velocity.y * SNAKE_SPEED * dt,
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

    let removedTail = false;
    if (player.segments.length > targetLength) {
      player.segments.pop();
      removedTail = true;
    }

    delta.playerUpdates[playerId] = {
      newHead,
      removeTail: removedTail,
      score: player.score,
      velocity: { ...player.velocity },
    };

    // Check collision with other players via spatial grid
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

  io.emit('delta', delta);
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
