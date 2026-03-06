export interface Vector2 {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
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
  color: string;
}

export interface GameState {
  players: Record<string, Player>;
  foods: Record<string, Food>;
  worldSize: number;
}

export interface ClientInput {
  targetDirection: Vector2;
}
