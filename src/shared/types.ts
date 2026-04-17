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
  targetDirection: Vector2;
}

export interface PlayerTickUpdate {
  newHead: Vector2;
  removeTail: number;
  score: number;
  velocity: Vector2;
  isBoosting: boolean;
}

export interface DeltaUpdate {
  playerUpdates: Record<string, PlayerTickUpdate>;
  newPlayers: Player[];
  removedPlayerIds: string[];
  newFoods: Food[];
  removedFoodIds: string[];
  summary: WorldSummary;
}
