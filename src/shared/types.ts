export interface Vector2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  hue: number;
  segments: Vector2[];
  velocity: Vector2;
  targetDirection: Vector2;
  score: number;
  isDead: boolean;
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

export interface ClientInput {
  targetDirection: Vector2;
}

export interface PlayerTickUpdate {
  newHead: Vector2;
  removeTail: boolean;
  score: number;
  velocity: Vector2;
}

export interface DeltaUpdate {
  playerUpdates: Record<string, PlayerTickUpdate>;
  newPlayers: Player[];
  removedPlayerIds: string[];
  newFoods: Food[];
  removedFoodIds: string[];
}
