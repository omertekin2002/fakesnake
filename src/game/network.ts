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
import {
  createPredictionState,
  PredictionState,
  reconcilePrediction,
  seedPrediction,
} from './prediction';
import {
  createInterpBuffer,
  InterpBuffer,
  recordSnapshot,
  removeInterpPlayer,
} from './interpolation';

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



export type UseGameNetworkOptions = {
  sessionVersion: number;
  playerNameRef: MutableRefObject<string>;
  appearanceRef: MutableRefObject<SnakeAppearance>;
  viewport: { width: number; height: number };
  onConnected: () => void;
  onScoreChange: (score: number) => void;
  onDeath: () => void;
  onKilled: (killerName: string) => void;
  onConnectionLost: () => void;
};

export type GameNetworkHandles = {
  socketRef: MutableRefObject<Socket | null>;
  gameStateRef: MutableRefObject<GameState | null>;
  worldSummaryRef: MutableRefObject<WorldSummary>;
  myIdRef: MutableRefObject<string | null>;
  scoreParticlesRef: MutableRefObject<ScoreParticle[]>;
  deathParticlesRef: MutableRefObject<DeathParticle[]>;
  predictionRef: MutableRefObject<PredictionState>;
  interpBufferRef: MutableRefObject<InterpBuffer>;
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
    onConnectionLost,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const worldSummaryRef = useRef<WorldSummary>({
    players: [],
    foodCount: 0,
    worldSize: DEFAULT_WORLD_SIZE,
  });
  const myIdRef = useRef<string | null>(null);
  const scoreParticlesRef = useRef<ScoreParticle[]>([]);
  const deathParticlesRef = useRef<DeathParticle[]>([]);
  const predictionRef = useRef<PredictionState>(createPredictionState());
  const interpBufferRef = useRef<InterpBuffer>(createInterpBuffer());

  const callbacksRef = useRef({ onConnected, onScoreChange, onDeath, onKilled, onConnectionLost });
  useEffect(() => {
    callbacksRef.current = { onConnected, onScoreChange, onDeath, onKilled, onConnectionLost };
  }, [onConnected, onScoreChange, onDeath, onKilled, onConnectionLost]);

  // Distinguishes intentional teardowns (death, menu, session change) from real
  // connection loss, so only the latter surfaces a "connection lost" screen.
  const intentionalDisconnectRef = useRef(false);

  useEffect(() => {
    if (sessionVersion === 0) {
      return;
    }

    intentionalDisconnectRef.current = false;
    // Auto-reconnect is off: the server can't resume a dropped snake, so a silent
    // reconnect would teleport the player into a fresh body. We surface the drop
    // instead and let the user rejoin explicitly.
    const newSocket = io(window.location.origin, {
      reconnection: false,
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
      const me = data.state.players[data.id];
      if (me) {
        seedPrediction(predictionRef.current, me.segments, me.velocity);
      }
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

      applyDelta(localState, delta);
      worldSummaryRef.current = delta.summary;

      // Re-base local prediction on the authoritative state for our own snake.
      if (myId) {
        const me = localState.players[myId];
        const myUpdate = delta.playerUpdates[myId];
        if (me && myUpdate && typeof myUpdate.seq === 'number') {
          reconcilePrediction(
            predictionRef.current,
            me.segments,
            me.velocity,
            myUpdate.seq,
            me.score,
          );
        }
      }

      // Buffer remote snake trails for entity interpolation.
      const interp = interpBufferRef.current;
      for (const removedId of delta.removedPlayerIds) {
        removeInterpPlayer(interp, removedId);
      }
      for (const id in localState.players) {
        if (id === myId) continue;
        recordSnapshot(interp, id, localState.players[id].segments, now);
      }

      if (myId && localState.players[myId]) {
        callbacksRef.current.onScoreChange(localState.players[myId].score);
      } else if (myId && !localState.players[myId]) {
        callbacksRef.current.onDeath();
        intentionalDisconnectRef.current = true;
        newSocket.disconnect();
        if (socketRef.current === newSocket) {
          socketRef.current = null;
        }
      }
    });

    newSocket.on('killed', (data: { killerName: string }) => {
      callbacksRef.current.onKilled(data.killerName);
    });

    // Unexpected drop (transport close, ping timeout, server restart) or a
    // failed initial connect (e.g. rejected by the per-IP limit).
    newSocket.on('disconnect', () => {
      if (intentionalDisconnectRef.current) return;
      if (socketRef.current === newSocket) socketRef.current = null;
      callbacksRef.current.onConnectionLost();
    });
    newSocket.on('connect_error', () => {
      if (intentionalDisconnectRef.current) return;
      callbacksRef.current.onConnectionLost();
    });

    return () => {
      intentionalDisconnectRef.current = true;
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
    predictionRef.current = createPredictionState();
    interpBufferRef.current = createInterpBuffer();
  }, []);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    socketRef.current?.disconnect();
    socketRef.current = null;
    gameStateRef.current = null;
    myIdRef.current = null;
    predictionRef.current = createPredictionState();
    interpBufferRef.current = createInterpBuffer();
  }, []);

  return useMemo(() => ({
    socketRef,
    gameStateRef,
    worldSummaryRef,
    myIdRef,
    scoreParticlesRef,
    deathParticlesRef,
    predictionRef,
    interpBufferRef,
    resetGameRefs,
    disconnect,
  }), [disconnect, resetGameRefs]);
};
