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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const state: GameState = {
  players: {},
  foods: {},
  worldSize: WORLD_SIZE,
};

let foodIdCounter = 0;

// Helper functions
const randomPosition = (): Vector2 => ({
  x: Math.random() * WORLD_SIZE,
  y: Math.random() * WORLD_SIZE,
});

const generateFoodId = () => `f${foodIdCounter++}`;

const randomColor = () => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 80%, 60%)`;
};

// Delta-aware food spawning: returns the newly created Food items
const spawnFood = (count: number): Food[] => {
  const spawned: Food[] = [];
  for (let i = 0; i < count; i++) {
    const id = generateFoodId();
    const food: Food = {
      id,
      position: randomPosition(),
      value: Math.floor(Math.random() * 5) + 1,
      color: randomColor(),
    };
    state.foods[id] = food;
    spawned.push(food);
  }
  return spawned;
};

// Initial food (no need to track delta for these — clients get full state on init)
spawnFood(FOOD_COUNT);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create new player
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
    color: randomColor(),
    segments,
    velocity: startDir,
    targetDirection: startDir,
    score: 0,
    isDead: false,
  };

  state.players[socket.id] = newPlayer;

  // New client gets the full state snapshot
  socket.emit('init', { id: socket.id, state });

  // Other clients will learn about this player via the next delta tick
  // (newPlayers array), so no separate broadcast needed here.
  // We store the player reference so the next tick picks it up as a newPlayer.
  pendingNewPlayers.push(newPlayer);

  socket.on('input', (targetDirection: Vector2) => {
    const player = state.players[socket.id];
    if (player && !player.isDead) {
      // Normalize target direction
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
    delete state.players[socket.id];
    pendingRemovedPlayerIds.push(socket.id);
  });
});

// Pending queues for events that happen between ticks
let pendingNewPlayers: Player[] = [];
let pendingRemovedPlayerIds: string[] = [];

let lastTime = Date.now();

const updateGame = () => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // Build delta for this tick
  const delta: DeltaUpdate = {
    playerUpdates: {},
    newPlayers: [...pendingNewPlayers],
    removedPlayerIds: [...pendingRemovedPlayerIds],
    newFoods: [],
    removedFoodIds: [],
  };

  // Clear pending queues
  pendingNewPlayers = [];
  pendingRemovedPlayerIds = [];

  // Maintain food count
  const currentFoodCount = Object.keys(state.foods).length;
  if (currentFoodCount < FOOD_COUNT) {
    const spawned = spawnFood(Math.min(FOOD_SPAWN_RATE, FOOD_COUNT - currentFoodCount));
    delta.newFoods.push(...spawned);
  }

  // Update players
  for (const playerId in state.players) {
    const player = state.players[playerId];
    if (player.isDead) continue;

    // Smoothly rotate velocity towards targetDirection
    const currentAngle = Math.atan2(player.velocity.y, player.velocity.x);
    const targetAngle = Math.atan2(player.targetDirection.y, player.targetDirection.x);
    
    let angleDiff = targetAngle - currentAngle;
    // Normalize angle difference to [-PI, PI]
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
    
    // Move head
    const newHead = {
      x: head.x + player.velocity.x * SNAKE_SPEED * dt,
      y: head.y + player.velocity.y * SNAKE_SPEED * dt,
    };

    // Keep inside world bounds
    newHead.x = Math.max(0, Math.min(WORLD_SIZE, newHead.x));
    newHead.y = Math.max(0, Math.min(WORLD_SIZE, newHead.y));

    // Update segments
    player.segments.unshift(newHead);

    // Check food collision
    for (const foodId in state.foods) {
      const food = state.foods[foodId];
      const dx = newHead.x - food.position.x;
      const dy = newHead.y - food.position.y;
      const distSq = dx * dx + dy * dy;
      
      // Collision radius
      if (distSq < 400) { // 20px radius
        player.score += food.value;
        delete state.foods[foodId];
        delta.removedFoodIds.push(foodId);
      }
    }

    // Determine target length based on score
    const targetLength = INITIAL_SNAKE_LENGTH + Math.floor(player.score * 2);

    // Remove tail if we are over target length
    let removedTail = false;
    if (player.segments.length > targetLength) {
      player.segments.pop();
      removedTail = true;
    }

    // Record this player's tick update in the delta
    delta.playerUpdates[playerId] = {
      newHead,
      removeTail: removedTail,
      score: player.score,
      velocity: { ...player.velocity },
    };

    // Check collision with other players
    for (const otherId in state.players) {
      if (playerId === otherId) continue;
      const other = state.players[otherId];
      if (other.isDead) continue;

      for (let i = 0; i < other.segments.length; i++) {
        const segment = other.segments[i];
        const dx = newHead.x - segment.x;
        const dy = newHead.y - segment.y;
        const distSq = dx * dx + dy * dy;

        // Collision radius for segments
        if (distSq < 225) { // 15px radius
          player.isDead = true;
          delta.removedPlayerIds.push(playerId);
          
          // Spawn food where player died
          player.segments.forEach((seg, index) => {
            if (index % 2 === 0) { // Don't spawn too much food
              const id = generateFoodId();
              const newFood: Food = {
                id,
                position: { ...seg },
                value: 3,
                color: player.color,
              };
              state.foods[id] = newFood;
              delta.newFoods.push(newFood);
            }
          });
          break;
        }
      }
      if (player.isDead) break;
    }
  }

  // Remove dead players from server state
  for (const playerId in state.players) {
    if (state.players[playerId].isDead) {
      delete state.players[playerId];
    }
  }

  // Broadcast delta instead of full state
  io.emit('delta', delta);
};

setInterval(updateGame, 1000 / TICK_RATE);

async function startServer() {
  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
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
