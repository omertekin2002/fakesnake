import { MutableRefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  DeltaUpdate,
  GameState,
  InitPayload,
  WorldSummary,
} from '../shared/types';
import {
  DEFAULT_SNAKE_APPEARANCE,
  getSnakePalette,
  SnakeAppearance,
} from '../shared/skins';
import { DeathParticle, ScoreParticle } from './render/particles';

export type InterpState = { prevX: number; prevY: number; currX: number; currY: number };

export const applyDelta = (localState: GameState, delta: DeltaUpdate): void => {
  for (const player of delta.newPlayers) {
    localState.players[player.id] = player;
  }

  for (const playerId in delta.playerUpdates) {
    const player = localState.players[playerId];
    if (!player) continue;

    const update = delta.playerUpdates[playerId];
    player.segments.unshift(update.newHead);
    for (let i = 0; i < update.removeTail; i++) {
      player.segments.pop();
    }
    player.score = update.score;
    player.velocity = update.velocity;
    player.isBoosting = update.isBoosting;
  }

  for (const id of delta.removedPlayerIds) {
    delete localState.players[id];
  }

  for (const food of delta.newFoods) {
    localState.foods[food.id] = food;
  }

  for (const id of delta.removedFoodIds) {
    delete localState.foods[id];
  }
};

const spawnScoreParticles = (
  localState: GameState,
  delta: DeltaUpdate,
  myId: string,
  particles: ScoreParticle[],
  now: number,
) => {
  const me = localState.players[myId];
  const myUpdate = delta.playerUpdates[myId];
  if (!me || !myUpdate || myUpdate.score <= me.score || delta.removedFoodIds.length === 0) {
    return;
  }

  const head = me.segments[0];
  for (const foodId of delta.removedFoodIds) {
    const food = localState.foods[foodId];
    if (!food) continue;
    const dx = food.position.x - head.x;
    const dy = food.position.y - head.y;
    if (dx * dx + dy * dy < 900) {
      particles.push({ x: food.position.x, y: food.position.y, value: food.value, createdAt: now });
    }
  }
};

const spawnDeathParticles = (
  localState: GameState,
  delta: DeltaUpdate,
  particles: DeathParticle[],
  now: number,
) => {
  for (const pid of delta.removedPlayerIds) {
    const dying = localState.players[pid];
    if (!dying) continue;
    const particleColor = getSnakePalette(
      dying.appearance?.paletteId ?? DEFAULT_SNAKE_APPEARANCE.paletteId,
    ).primary;
    const segs = dying.segments;
    for (let i = 0; i < segs.length; i += 3) {
      const seg = segs[i];
      for (let j = 0; j < 3; j++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 80;
        particles.push({
          x: seg.x,
          y: seg.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 2 + Math.random() * 4,
          color: particleColor,
          createdAt: now,
        });
      }
    }
  }
};

const captureInterpState = (
  localState: GameState,
  delta: DeltaUpdate,
  interp: Map<string, InterpState>,
) => {
  for (const playerId in delta.playerUpdates) {
    const player = localState.players[playerId];
    if (!player) continue;
    const prev = player.segments[0];
    const curr = delta.playerUpdates[playerId].newHead;
    interp.set(playerId, { prevX: prev.x, prevY: prev.y, currX: curr.x, currY: curr.y });
  }
  for (const pid of delta.removedPlayerIds) {
    interp.delete(pid);
  }
};

export type UseGameNetworkOptions = {
  sessionVersion: number;
  playerNameRef: MutableRefObject<string>;
  appearanceRef: MutableRefObject<SnakeAppearance>;
  viewport: { width: number; height: number };
  onConnected: () => void;
  onScoreChange: (score: number) => void;
  onDeath: () => void;
  onKilled: (killerName: string) => void;
};

export type GameNetworkHandles = {
  socketRef: MutableRefObject<Socket | null>;
  gameStateRef: MutableRefObject<GameState | null>;
  worldSummaryRef: MutableRefObject<WorldSummary>;
  myIdRef: MutableRefObject<string | null>;
  interpRef: MutableRefObject<Map<string, InterpState>>;
  lastDeltaTimeRef: MutableRefObject<number>;
  scoreParticlesRef: MutableRefObject<ScoreParticle[]>;
  deathParticlesRef: MutableRefObject<DeathParticle[]>;
  resetGameRefs: () => void;
  disconnect: () => void;
};

const DEFAULT_WORLD_SIZE = 3000;

export const useGameNetwork = (options: UseGameNetworkOptions): GameNetworkHandles => {
  const {
    sessionVersion,
    playerNameRef,
    appearanceRef,
    viewport,
    onConnected,
    onScoreChange,
    onDeath,
    onKilled,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const worldSummaryRef = useRef<WorldSummary>({
    players: [],
    foodCount: 0,
    worldSize: DEFAULT_WORLD_SIZE,
  });
  const myIdRef = useRef<string | null>(null);
  const interpRef = useRef<Map<string, InterpState>>(new Map());
  const lastDeltaTimeRef = useRef(0);
  const scoreParticlesRef = useRef<ScoreParticle[]>([]);
  const deathParticlesRef = useRef<DeathParticle[]>([]);

  const callbacksRef = useRef({ onConnected, onScoreChange, onDeath, onKilled });
  useEffect(() => {
    callbacksRef.current = { onConnected, onScoreChange, onDeath, onKilled };
  }, [onConnected, onScoreChange, onDeath, onKilled]);

  useEffect(() => {
    if (sessionVersion === 0) {
      return;
    }

    const newSocket = io(window.location.origin, {
      auth: {
        name: playerNameRef.current.trim() || undefined,
        appearance: appearanceRef.current,
        viewport,
      },
    });
    socketRef.current = newSocket;

    newSocket.on('init', (data: InitPayload) => {
      myIdRef.current = data.id;
      gameStateRef.current = data.state;
      worldSummaryRef.current = data.summary;
      callbacksRef.current.onConnected();
    });

    newSocket.on('delta', (delta: DeltaUpdate) => {
      const localState = gameStateRef.current;
      if (!localState) return;

      const myId = myIdRef.current;
      const now = performance.now();

      if (myId) {
        spawnScoreParticles(localState, delta, myId, scoreParticlesRef.current, now);
      }
      if (delta.removedPlayerIds.length > 0) {
        spawnDeathParticles(localState, delta, deathParticlesRef.current, now);
      }

      captureInterpState(localState, delta, interpRef.current);
      lastDeltaTimeRef.current = now;

      applyDelta(localState, delta);
      worldSummaryRef.current = delta.summary;

      if (myId && localState.players[myId]) {
        callbacksRef.current.onScoreChange(localState.players[myId].score);
      } else if (myId && !localState.players[myId]) {
        callbacksRef.current.onDeath();
        newSocket.disconnect();
        if (socketRef.current === newSocket) {
          socketRef.current = null;
        }
      }
    });

    newSocket.on('killed', (data: { killerName: string }) => {
      callbacksRef.current.onKilled(data.killerName);
    });

    return () => {
      newSocket.disconnect();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVersion]);

  const resetGameRefs = useCallback(() => {
    gameStateRef.current = null;
    myIdRef.current = null;
    scoreParticlesRef.current = [];
    deathParticlesRef.current = [];
    interpRef.current.clear();
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    gameStateRef.current = null;
    myIdRef.current = null;
  }, []);

  return useMemo(() => ({
    socketRef,
    gameStateRef,
    worldSummaryRef,
    myIdRef,
    interpRef,
    lastDeltaTimeRef,
    scoreParticlesRef,
    deathParticlesRef,
    resetGameRefs,
    disconnect,
  }), [disconnect, resetGameRefs]);
};
