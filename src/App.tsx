import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, Player, DeltaUpdate } from './shared/types';

const WORLD_SIZE = 3000;
const GRID_SIZE = 50;
const MENU_DRIFT_RANGE = 18;
const INPUT_THROTTLE_MS = 1000 / 30; // match server tick rate

type GamePhase = 'menu' | 'connecting' | 'playing' | 'dead';

type MenuFood = {
  x: number;
  y: number;
  value: number;
  hue: number;
  driftOffset: number;
  driftSpeed: number;
};

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

// ── Hue-to-HSL conversion (shared helper) ────────────────────────────
const hueToHsl = (hue: number) => `hsl(${hue}, 80%, 60%)`;

const createMenuFoods = (width: number, height: number): MenuFood[] => {
  const count = Math.max(35, Math.floor((width * height) / 22000));

  return Array.from({ length: count }, (_, index) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    value: (index % 5) + 1,
    hue: (index * 47) % 360,
    driftOffset: Math.random() * Math.PI * 2,
    driftSpeed: 0.6 + Math.random() * 0.8,
  }));
};

// ── Optimized grid: single batched path ──────────────────────────────
const drawGrid = (
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  cameraY: number,
  width: number,
  height: number,
) => {
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startX = Math.floor(cameraX / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(cameraY / GRID_SIZE) * GRID_SIZE;

  for (let x = startX; x < cameraX + width; x += GRID_SIZE) {
    ctx.moveTo(x, cameraY);
    ctx.lineTo(x, cameraY + height);
  }

  for (let y = startY; y < cameraY + height; y += GRID_SIZE) {
    ctx.moveTo(cameraX, y);
    ctx.lineTo(cameraX + width, y);
  }

  ctx.stroke();
};

// ── Optimized food glow: pre-rendered offscreen sprites ──────────────
const glowSpriteCache = new Map<string, HTMLCanvasElement>();

const getGlowSprite = (radius: number, color: string, glowStrength: number): HTMLCanvasElement => {
  const key = `${color}|${radius}|${glowStrength}`;
  let sprite = glowSpriteCache.get(key);
  if (sprite) return sprite;

  const padding = glowStrength * 2;
  const size = (radius + padding) * 2;
  sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;

  const sctx = sprite.getContext('2d')!;
  sctx.fillStyle = color;
  sctx.shadowBlur = glowStrength;
  sctx.shadowColor = color;
  sctx.beginPath();
  sctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  sctx.fill();

  glowSpriteCache.set(key, sprite);
  return sprite;
};

const drawFoodBlob = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  glowStrength: number,
) => {
  const sprite = getGlowSprite(radius, color, glowStrength);
  ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2);
};

// Apply a DeltaUpdate to a local GameState (mutates in place)
const applyDelta = (localState: GameState, delta: DeltaUpdate): void => {
  for (const player of delta.newPlayers) {
    localState.players[player.id] = player;
  }

  for (const playerId in delta.playerUpdates) {
    const player = localState.players[playerId];
    if (!player) continue;

    const update = delta.playerUpdates[playerId];
    player.segments.unshift(update.newHead);
    if (update.removeTail) {
      player.segments.pop();
    }
    player.score = update.score;
    player.velocity = update.velocity;
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const menuFoodsRef = useRef<MenuFood[]>([]);

  // Game state lives in a ref — no React re-renders per tick
  const gameStateRef = useRef<GameState | null>(null);
  const myIdRef = useRef<string | null>(null);

  // UI-level state that needs React renders
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [sessionVersion, setSessionVersion] = useState(0);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // ── Imperative canvas sizing ───────────────────────────────────────
  // Set canvas width/height directly via the DOM instead of React props
  // to avoid React clearing the canvas buffer on re-render.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = windowSize.width;
    canvas.height = windowSize.height;
  }, [windowSize.width, windowSize.height]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    menuFoodsRef.current = createMenuFoods(windowSize.width, windowSize.height);
  }, [windowSize.height, windowSize.width]);

  useEffect(() => {
    window.render_game_to_text = () => {
      const gs = gameStateRef.current;
      return JSON.stringify({
        mode: phase,
        myId: myIdRef.current,
        score,
        players: gs ? Object.keys(gs.players).length : 0,
        foods: gs ? Object.keys(gs.foods).length : 0,
        viewport: windowSize,
        coordinates: 'origin at top-left, +x right, +y down',
      });
    };

    return () => {
      delete window.render_game_to_text;
    };
  }, [phase, score, windowSize]);

  useEffect(() => {
    if (sessionVersion === 0) {
      return;
    }

    const newSocket = io(window.location.origin);
    socketRef.current = newSocket;

    newSocket.on('init', (data: { id: string; state: GameState }) => {
      myIdRef.current = data.id;
      gameStateRef.current = data.state;
      setPhase('playing');
    });

    newSocket.on('delta', (delta: DeltaUpdate) => {
      const localState = gameStateRef.current;
      if (!localState) return;

      applyDelta(localState, delta);

      const myId = myIdRef.current;
      if (myId && localState.players[myId]) {
        setScore(localState.players[myId].score);
      } else if (myId && !localState.players[myId]) {
        setPhase('dead');
      }
    });

    newSocket.on('playerDied', (id: string) => {
      if (id === newSocket.id) {
        setPhase('dead');
      }
    });

    return () => {
      newSocket.disconnect();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
      }
    };
  }, [sessionVersion]);

  useEffect(() => {
    if (phase !== 'playing' || !myIdRef.current) {
      return;
    }

    let lastEmitTime = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastEmitTime < INPUT_THROTTLE_MS) return;
      lastEmitTime = now;

      if (!canvasRef.current) return;

      const socket = socketRef.current;
      if (!socket) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - windowSize.width / 2;
      const y = e.clientY - rect.top - windowSize.height / 2;

      socket.emit('input', { x, y });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [phase, windowSize.height, windowSize.width]);

  const returnToMenu = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    gameStateRef.current = null;
    myIdRef.current = null;
    setScore(0);
    setPhase('menu');
  }, []);

  useEffect(() => {
    if (phase === 'menu') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        returnToMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, returnToMenu]);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let animationFrameId = 0;

    const renderMenuScene = (time: number) => {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, windowSize.width, windowSize.height);

      drawGrid(ctx, 0, 0, windowSize.width, windowSize.height);

      for (const food of menuFoodsRef.current) {
        const drift = Math.sin(time * 0.001 * food.driftSpeed + food.driftOffset) * MENU_DRIFT_RANGE;
        const verticalDrift = Math.cos(time * 0.0012 * food.driftSpeed + food.driftOffset) * (MENU_DRIFT_RANGE * 0.65);
        const color = hueToHsl(food.hue);
        drawFoodBlob(
          ctx,
          food.x + drift,
          food.y + verticalDrift,
          5 + food.value,
          color,
          10 + food.value * 1.5,
        );
      }

      const vignette = ctx.createRadialGradient(
        windowSize.width / 2,
        windowSize.height / 2,
        Math.min(windowSize.width, windowSize.height) * 0.15,
        windowSize.width / 2,
        windowSize.height / 2,
        Math.max(windowSize.width, windowSize.height) * 0.7,
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, windowSize.width, windowSize.height);
    };

    const render = (time: number) => {
      const gameState = gameStateRef.current;
      const myId = myIdRef.current;
      const me = myId && gameState ? gameState.players[myId] : null;

      if (phase !== 'playing' || !gameState || !me) {
        renderMenuScene(time);
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, windowSize.width, windowSize.height);

      const cameraX = me.segments[0].x - windowSize.width / 2;
      const cameraY = me.segments[0].y - windowSize.height / 2;

      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      drawGrid(ctx, cameraX, cameraY, windowSize.width, windowSize.height);

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      for (const foodId in gameState.foods) {
        const food = gameState.foods[foodId];
        if (
          food.position.x > cameraX - 20 &&
          food.position.x < cameraX + windowSize.width + 20 &&
          food.position.y > cameraY - 20 &&
          food.position.y < cameraY + windowSize.height + 20
        ) {
          drawFoodBlob(ctx, food.position.x, food.position.y, 5 + food.value, hueToHsl(food.hue), 10);
        }
      }

      // ── Optimized snake rendering: batch body segments per player ──
      for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        const head = player.segments[0];
        const playerColor = hueToHsl(player.hue);

        // Batch all body segments (index > 0) into a single path
        ctx.fillStyle = playerColor;
        ctx.beginPath();
        for (let i = player.segments.length - 1; i > 0; i--) {
          const segment = player.segments[i];
          if (
            segment.x > cameraX - 30 &&
            segment.x < cameraX + windowSize.width + 30 &&
            segment.y > cameraY - 30 &&
            segment.y < cameraY + windowSize.height + 30
          ) {
            ctx.moveTo(segment.x + 12, segment.y);
            ctx.arc(segment.x, segment.y, 12, 0, Math.PI * 2);
          }
        }
        ctx.fill();

        // Draw head separately (larger + eyes)
        if (
          head.x > cameraX - 30 &&
          head.x < cameraX + windowSize.width + 30 &&
          head.y > cameraY - 30 &&
          head.y < cameraY + windowSize.height + 30
        ) {
          ctx.fillStyle = playerColor;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 15, 0, Math.PI * 2);
          ctx.fill();

          // Eyes
          const eyeOffset = 5;
          ctx.fillStyle = 'white';
          ctx.beginPath();
          ctx.moveTo(head.x - eyeOffset + 4, head.y - eyeOffset);
          ctx.arc(head.x - eyeOffset, head.y - eyeOffset, 4, 0, Math.PI * 2);
          ctx.moveTo(head.x + eyeOffset + 4, head.y - eyeOffset);
          ctx.arc(head.x + eyeOffset, head.y - eyeOffset, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'black';
          ctx.beginPath();
          ctx.moveTo(head.x - eyeOffset + 2, head.y - eyeOffset);
          ctx.arc(head.x - eyeOffset, head.y - eyeOffset, 2, 0, Math.PI * 2);
          ctx.moveTo(head.x + eyeOffset + 2, head.y - eyeOffset);
          ctx.arc(head.x + eyeOffset, head.y - eyeOffset, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Player name above head
        if (
          head.x > cameraX - 50 &&
          head.x < cameraX + windowSize.width + 50 &&
          head.y > cameraY - 50 &&
          head.y < cameraY + windowSize.height + 50
        ) {
          ctx.fillStyle = 'white';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(player.name, head.x, head.y - 25);
        }
      }

      ctx.restore();

      ctx.fillStyle = 'white';
      ctx.font = '20px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`Score: ${me.score}`, 20, windowSize.height - 24);

      const sortedPlayers = (Object.values(gameState.players) as Player[])
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      ctx.textAlign = 'right';
      ctx.fillText('Leaderboard', windowSize.width - 20, 30);
      ctx.font = '16px Arial';

      sortedPlayers.forEach((player, index) => {
        ctx.fillStyle = player.id === myId ? 'yellow' : 'white';
        ctx.fillText(`${index + 1}. ${player.name}: ${player.score}`, windowSize.width - 20, 60 + index * 25);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [phase, windowSize.height, windowSize.width]);

  const startGame = () => {
    gameStateRef.current = null;
    myIdRef.current = null;
    setScore(0);
    setPhase('connecting');
    setSessionVersion((value) => value + 1);
  };

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-neutral-900 font-sans text-white">
      <div className="relative h-screen w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className={`block bg-[#1a1a1a] ${phase === 'playing' ? 'cursor-crosshair' : 'cursor-default'}`}
        />

        {phase === 'menu' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/12">
            <div className="flex flex-col items-center gap-8 px-6 text-center">
              <h1 className="text-5xl font-black uppercase tracking-[0.22em] text-white sm:text-7xl [text-shadow:0_0_30px_rgba(16,185,129,0.35)]">
                Lil Snake Game
              </h1>
              <button
                id="start-btn"
                onClick={startGame}
                className="rounded-md border border-emerald-300/35 bg-emerald-500 px-8 py-3 text-lg font-semibold text-white transition hover:bg-emerald-400"
              >
                Start Game
              </button>
            </div>
          </div>
        )}

        {phase === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/28">
            <div className="rounded-md border border-white/10 bg-black/35 px-6 py-3 text-lg font-semibold text-white">
              Starting...
            </div>
          </div>
        )}

        {(phase === 'playing' || phase === 'connecting') && (
          <button
            onClick={returnToMenu}
            className="absolute left-5 top-5 rounded-md border border-white/15 bg-black/40 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/60"
          >
            Exit
          </button>
        )}

        {phase === 'dead' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 backdrop-blur-sm">
            <h2 className="mb-4 text-5xl font-bold text-red-500">Game Over</h2>
            <p className="mb-8 text-xl">Final Score: {score}</p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={startGame}
                className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-600"
              >
                Play Again
              </button>
              <button
                onClick={returnToMenu}
                className="rounded-md bg-white/10 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/20"
              >
                Main Menu
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
