import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SNAKE_APPEARANCE,
  normalizeSnakeAppearance,
  SnakeAppearance,
} from './shared/skins';
import { ClientInput } from './shared/types';
import { useGameNetwork } from './game/network';
import { predictInput } from './game/prediction';
import { INTERP_DELAY_MS, writeInterpolatedSnake } from './game/interpolation';
import { drawGrid, drawWorldBorder } from './game/render/grid';
import { drawFoods, pruneDistantFoods } from './game/render/food';
import { drawSnake } from './game/render/snake';
import { drawDeathParticles, drawScoreParticles } from './game/render/particles';
import { createMenuFoods, MenuFood, renderMenuScene } from './game/render/menuScene';
import {
  createLeaderboardCache,
  drawLeaderboard,
  drawMinimap,
  drawPlayerCount,
  drawScore,
} from './game/render/hud';
import { MainMenu } from './components/MainMenu';
import { ConnectingOverlay } from './components/ConnectingOverlay';
import { DeathScreen } from './components/DeathScreen';
import { ConnectionLostScreen } from './components/ConnectionLostScreen';
import { ExitButton } from './components/ExitButton';

const TICK_MS = 1000 / 30;
const FOOD_PRUNE_INTERVAL = 2000;
const FOOD_PRUNE_MARGIN = 1400;
const CONNECT_TIMEOUT_MS = 10000;

type GamePhase = 'menu' | 'connecting' | 'playing' | 'dead' | 'disconnected';

// ── Lightweight localStorage persistence (name, skin, high score) ────────────
const STORAGE_KEYS = {
  name: 'fakesnake:name',
  appearance: 'fakesnake:appearance',
  best: 'fakesnake:best',
};

const loadName = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEYS.name) ?? '';
  } catch {
    return '';
  }
};

const loadAppearance = (): SnakeAppearance => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.appearance);
    return raw ? normalizeSnakeAppearance(JSON.parse(raw)) : DEFAULT_SNAKE_APPEARANCE;
  } catch {
    return DEFAULT_SNAKE_APPEARANCE;
  }
};

const loadBest = (): number => {
  try {
    return Number(localStorage.getItem(STORAGE_KEYS.best)) || 0;
  } catch {
    return 0;
  }
};

const persist = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota) — ignore */
  }
};

const isTouchDevice = (): boolean =>
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

declare global {
  interface Window {
    render_game_to_text?: () => string;
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuFoodsRef = useRef<MenuFood[]>([]);
  const playerNameRef = useRef('');
  const appearanceRef = useRef<SnakeAppearance>(DEFAULT_SNAKE_APPEARANCE);
  // Shared input state read by the 30Hz tick (and, on touch, the boost button).
  const boostRef = useRef(false);
  const scoreRef = useRef(0);

  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [playerName, setPlayerName] = useState(loadName);
  const [appearance, setAppearance] = useState<SnakeAppearance>(loadAppearance);
  const [killedBy, setKilledBy] = useState<string | null>(null);
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [bestScore, setBestScore] = useState(loadBest);
  const [isNewBest, setIsNewBest] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [isTouch] = useState(isTouchDevice);

  // Latest window size for the rAF render loop / input tick, so neither effect
  // has to re-subscribe (tearing down the input clock) on every resize.
  const windowSizeRef = useRef(windowSize);
  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);

  const onConnected = useCallback(() => setPhase('playing'), []);
  const onScoreChange = useCallback((next: number) => {
    scoreRef.current = next;
    setScore(next);
  }, []);
  const onDeath = useCallback(() => {
    const finalScore = scoreRef.current;
    setBestScore((prevBest) => {
      const newBest = Math.max(prevBest, finalScore);
      setIsNewBest(finalScore > prevBest && finalScore > 0);
      if (newBest !== prevBest) persist(STORAGE_KEYS.best, String(newBest));
      return newBest;
    });
    setPhase('dead');
  }, []);
  const onKilled = useCallback((killerName: string) => setKilledBy(killerName), []);
  const onConnectionLost = useCallback((reason?: string) => {
    setDisconnectReason(reason ?? null);
    setPhase('disconnected');
  }, []);

  const network = useGameNetwork({
    sessionVersion,
    playerNameRef,
    appearanceRef,
    viewport: windowSize,
    onConnected,
    onScoreChange,
    onDeath,
    onKilled,
    onConnectionLost,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = windowSize.width * dpr;
    canvas.height = windowSize.height * dpr;
    canvas.style.width = `${windowSize.width}px`;
    canvas.style.height = `${windowSize.height}px`;
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

  // Persist name + skin so returning players keep them.
  useEffect(() => {
    playerNameRef.current = playerName;
    persist(STORAGE_KEYS.name, playerName);
  }, [playerName]);

  useEffect(() => {
    appearanceRef.current = appearance;
    persist(STORAGE_KEYS.appearance, JSON.stringify(appearance));
  }, [appearance]);

  useEffect(() => {
    network.socketRef.current?.emit('viewport', windowSize);
  }, [network.socketRef, windowSize]);

  // Debug/automation hook — dev-only, installed once (reads live state via ref).
  const debugRef = useRef({ phase, score, appearance, windowSize });
  useEffect(() => {
    debugRef.current = { phase, score, appearance, windowSize };
  }, [phase, score, appearance, windowSize]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.render_game_to_text = () => {
      const { phase, score, appearance, windowSize } = debugRef.current;
      const gs = network.gameStateRef.current;
      const summary = network.worldSummaryRef.current;
      return JSON.stringify({
        mode: phase,
        myId: network.myIdRef.current,
        score,
        players: summary.players.length,
        foods: summary.foodCount,
        visiblePlayers: gs ? Object.keys(gs.players).length : 0,
        visibleFoods: gs ? Object.keys(gs.foods).length : 0,
        appearance,
        viewport: windowSize,
        coordinates: 'origin at top-left, +x right, +y down',
      });
    };
    return () => {
      delete window.render_game_to_text;
    };
  }, [network]);

  useEffect(() => {
    if (phase !== 'playing' || !network.myIdRef.current) {
      return;
    }

    const pointer = { x: 0, y: 0 };
    // Seed heading from the current prediction so an idle pointer keeps us moving
    // straight (the server likewise keeps the last targetDirection).
    const lastDir = { ...network.predictionRef.current.velocity };

    // Pointer Events cover mouse, pen, and touch with one set of handlers.
    const handlePointerMove = (e: PointerEvent) => {
      // Ignore moves that originate on the on-screen boost button.
      if ((e.target as HTMLElement | null)?.dataset?.boostButton !== undefined) return;
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const ws = windowSizeRef.current;
      pointer.x = e.clientX - rect.left - ws.width / 2;
      pointer.y = e.clientY - rect.top - ws.height / 2;
    };

    // Mouse: left button boosts. Touch boost is the on-screen button instead, so
    // that tapping to steer doesn't also boost.
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 0) boostRef.current = true;
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 0) boostRef.current = false;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        boostRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') boostRef.current = false;
    };

    // Fixed-rate prediction tick: advance the local snake immediately from input
    // and send that input (tagged with a seq) for the server to acknowledge.
    const tickInput = () => {
      const socket = network.socketRef.current;
      const myId = network.myIdRef.current;
      if (!socket || !myId) return;

      const len = Math.hypot(pointer.x, pointer.y);
      if (len > 0) {
        lastDir.x = pointer.x / len;
        lastDir.y = pointer.y / len;
      }

      const seq = predictInput(
        network.predictionRef.current,
        lastDir,
        boostRef.current,
        performance.now(),
      );
      const input: ClientInput = { x: lastDir.x, y: lastDir.y, boost: boostRef.current, seq };
      socket.emit('input', input);
    };

    const intervalId = window.setInterval(tickInput, TICK_MS);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      boostRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [phase, network]);

  const returnToMenu = useCallback(() => {
    network.disconnect();
    setScore(0);
    setPhase('menu');
  }, [network]);

  // Give up the "connecting" overlay if the handshake never completes.
  useEffect(() => {
    if (phase !== 'connecting') return;
    const timer = window.setTimeout(() => {
      network.disconnect();
      setDisconnectReason('Could not reach the server in time.');
      setPhase('disconnected');
    }, CONNECT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, network]);

  useEffect(() => {
    if (phase === 'menu') return;

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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let lastFoodPruneTime = 0;
    let lastRenderTime = performance.now();
    const leaderboardCache = createLeaderboardCache();

    const render = (time: number) => {
      const ws = windowSizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const gameState = network.gameStateRef.current;
      const summary = network.worldSummaryRef.current;
      const myId = network.myIdRef.current;
      const me = myId && gameState ? gameState.players[myId] : null;

      if (phase !== 'playing' || !gameState || !me) {
        renderMenuScene(ctx, menuFoodsRef.current, ws.width, ws.height, time);
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, ws.width, ws.height);

      const nowTime = performance.now();
      const dt = Math.min((nowTime - lastRenderTime) / 1000, 0.1);
      lastRenderTime = nowTime;

      // The local snake eases toward its (lag-free) predicted trail; remote
      // snakes use a render-delayed interpolation buffer (writeInterpolatedSnake).
      const selfLerpRate = 1 - Math.exp(-28 * dt);

      const prediction = network.predictionRef.current;
      const interpBuffer = network.interpBufferRef.current;
      const renderTime = nowTime - INTERP_DELAY_MS;

      for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        const isSelf =
          playerId === myId && prediction.initialized && prediction.segments.length > 0;

        if (!isSelf) {
          // Remote snake: interpolate between buffered authoritative snapshots.
          writeInterpolatedSnake(interpBuffer, playerId, renderTime, player);
          continue;
        }

        // Local snake: ease the smoothed trail toward the prediction.
        const targetSegments = prediction.segments;
        if (!player.smoothSegments || player.smoothSegments.length !== targetSegments.length) {
          if (player.smoothSegments && Math.abs(player.smoothSegments.length - targetSegments.length) <= 2) {
            if (player.smoothSegments.length < targetSegments.length) {
              while (player.smoothSegments.length < targetSegments.length) {
                player.smoothSegments.unshift({ ...targetSegments[0] });
              }
            } else {
              while (player.smoothSegments.length > targetSegments.length) {
                player.smoothSegments.pop();
              }
            }
          } else {
            player.smoothSegments = targetSegments.map((seg) => ({ ...seg }));
          }
        } else {
          for (let i = 0; i < targetSegments.length; i++) {
            const target = targetSegments[i];
            const smooth = player.smoothSegments[i];
            smooth.x += (target.x - smooth.x) * selfLerpRate;
            smooth.y += (target.y - smooth.y) * selfLerpRate;
          }
        }
      }

      const myHead = me.smoothSegments?.[0] || me.segments[0];
      const camera = {
        x: myHead.x - ws.width / 2,
        y: myHead.y - ws.height / 2,
        width: ws.width,
        height: ws.height,
      };

      ctx.save();
      ctx.translate(-camera.x, -camera.y);

      drawGrid(ctx, camera.x, camera.y, camera.width, camera.height);
      drawWorldBorder(ctx, gameState.worldSize);

      if (time - lastFoodPruneTime > FOOD_PRUNE_INTERVAL) {
        lastFoodPruneTime = time;
        pruneDistantFoods(gameState.foods, myHead.x, myHead.y, FOOD_PRUNE_MARGIN);
      }
      drawFoods(ctx, gameState.foods, camera);

      for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        const headVelocity =
          playerId === myId && prediction.initialized ? prediction.velocity : undefined;
        drawSnake(ctx, player, camera, headVelocity);
      }

      const now = performance.now();
      drawScoreParticles(ctx, network.scoreParticlesRef.current, now);
      drawDeathParticles(ctx, network.deathParticlesRef.current, now);

      ctx.restore();

      drawScore(ctx, me.score, ws.height);
      drawPlayerCount(ctx, summary.players.length, ws.height);
      drawLeaderboard(ctx, summary, myId, me.name, me.score, ws.width, leaderboardCache, now);
      drawMinimap(ctx, summary, myId, myHead, camera, gameState.worldSize);

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [network, phase]);

  const startGame = () => {
    network.resetGameRefs();
    setScore(0);
    scoreRef.current = 0;
    setKilledBy(null);
    setDisconnectReason(null);
    setPhase('connecting');
    setSessionVersion((value) => value + 1);
  };

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-neutral-900 font-sans text-white">
      <div className="relative h-screen w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className={`block touch-none bg-[#1a1a1a] ${
            phase === 'playing' && !isTouch ? 'cursor-crosshair' : 'cursor-default'
          }`}
        />

        {phase === 'menu' && (
          <MainMenu
            playerName={playerName}
            onNameChange={setPlayerName}
            appearance={appearance}
            onAppearanceChange={setAppearance}
            onStart={startGame}
          />
        )}

        {phase === 'connecting' && <ConnectingOverlay />}

        {(phase === 'playing' || phase === 'connecting') && <ExitButton onClick={returnToMenu} />}

        {phase === 'playing' && isTouch && (
          <button
            data-boost-button=""
            onPointerDown={(e) => {
              e.preventDefault();
              boostRef.current = true;
            }}
            onPointerUp={() => {
              boostRef.current = false;
            }}
            onPointerLeave={() => {
              boostRef.current = false;
            }}
            onPointerCancel={() => {
              boostRef.current = false;
            }}
            className="absolute bottom-8 right-8 h-24 w-24 select-none rounded-full border border-emerald-300/40 bg-emerald-500/30 text-sm font-bold uppercase tracking-wider text-white backdrop-blur active:bg-emerald-500/60"
          >
            Boost
          </button>
        )}

        {phase === 'dead' && (
          <DeathScreen
            score={score}
            killedBy={killedBy}
            bestScore={bestScore}
            isNewBest={isNewBest}
            onPlayAgain={startGame}
            onMainMenu={returnToMenu}
          />
        )}

        {phase === 'disconnected' && (
          <ConnectionLostScreen
            reason={disconnectReason}
            onReconnect={startGame}
            onMainMenu={returnToMenu}
          />
        )}
      </div>
    </div>
  );
}
