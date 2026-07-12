import { SnakeAppearance } from './skins';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  hue: number;
  appearance: SnakeAppearance;
  segments: Vector2[];
  velocity: Vector2;
  targetDirection: Vector2;
  score: number;
  isDead: boolean;
  isBoosting: boolean;
  smoothSegments?: Vector2[];
}

export interface Food {
  id: string;
  position: Vector2;
  value: number;
  hue: number;
}

export interface GameState {
  players: Record<string, Player>;
  foods: Record<string, Food>;
  worldSize: number;
}

export interface WorldPlayerSummary {
  id: string;
  name: string;
  appearance: SnakeAppearance;
  position: Vector2;
  score: number;
}

export interface WorldSummary {
  players: WorldPlayerSummary[];
  foodCount: number;
  worldSize: number;
}

export interface InitPayload {
  id: string;
  state: GameState;
  summary: WorldSummary;
}

export interface ClientInput {
  x: number;
  y: number;
  boost: boolean;
  // Monotonic per-client input sequence number. The server echoes the latest
  // applied seq back in PlayerTickUpdate so the client can reconcile prediction.
  seq: number;
}

export interface PlayerTickUpdate {
  newHead: Vector2;
  removeTail: number;
  score: number;
  velocity: Vector2;
  isBoosting: boolean;
  // The last input seq the server had applied for this player as of this tick.
  // Only meaningful to the owning client (used for prediction reconciliation).
  seq?: number;
}

export interface DeltaUpdate {
  playerUpdates: Record<string, PlayerTickUpdate>;
  newPlayers: Player[];
  // Players who died (or disconnected). The client drops them AND plays the
  // death effect. A client's own id appearing here is how it learns it died.
  removedPlayerIds: string[];
  // Players who merely left this client's AOI — still alive, just out of
  // sight. The client drops them silently (no death explosion).
  despawnedPlayerIds: string[];
  newFoods: Food[];
  removedFoodIds: string[];
}

// The world summary (leaderboard + minimap) is not AOI-culled, so it rides its
// own lower-frequency 'summary' event rather than every per-tick delta.
