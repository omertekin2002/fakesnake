import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SNAKE_APPEARANCE, SnakeAppearance } from './shared/skins';
import { useGameNetwork } from './game/network';
import { predictInput } from './game/prediction';
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
import { ExitButton } from './components/ExitButton';

const TICK_MS = 1000 / 30;
const FOOD_PRUNE_INTERVAL = 2000;
const FOOD_PRUNE_MARGIN = 1400;

type GamePhase = 'menu' | 'connecting' | 'playing' | 'dead';

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

  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [playerName, setPlayerName] = useState('');
  const [appearance, setAppearance] = useState<SnakeAppearance>(DEFAULT_SNAKE_APPEARANCE);
  const [killedBy, setKilledBy] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const onConnected = useCallback(() => setPhase('playing'), []);
  const onDeath = useCallback(() => setPhase('dead'), []);
  const onKilled = useCallback((killerName: string) => setKilledBy(killerName), []);

  const network = useGameNetwork({
    sessionVersion,
    playerNameRef,
    appearanceRef,
    viewport: windowSize,
    onConnected,
    onScoreChange: setScore,
    onDeath,
    onKilled,
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

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  useEffect(() => {
    network.socketRef.current?.emit('viewport', windowSize);
  }, [network.socketRef, windowSize]);

  useEffect(() => {
    window.render_game_to_text = () => {
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
  }, [appearance, network, phase, score, windowSize]);

  useEffect(() => {
    if (phase !== 'playing' || !network.myIdRef.current) {
      return;
    }

    const mousePos = { x: 0, y: 0 };
    // Seed heading from the current prediction so an idle mouse keeps us moving
    // straight (the server likewise keeps the last targetDirection).
    const lastDir = { ...network.predictionRef.current.velocity };
    let boosting = false;

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      mousePos.x = e.clientX - rect.left - windowSize.width / 2;
      mousePos.y = e.clientY - rect.top - windowSize.height / 2;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) boosting = true;
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) boosting = false;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        boosting = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') boosting = false;
    };

    // Fixed-rate prediction tick: advance the local snake immediately from input
    // and send that input (tagged with a seq) for the server to acknowledge.
    const tickInput = () => {
      const socket = network.socketRef.current;
      const myId = network.myIdRef.current;
      if (!socket || !myId) return;

      const len = Math.hypot(mousePos.x, mousePos.y);
      if (len > 0) {
        lastDir.x = mousePos.x / len;
        lastDir.y = mousePos.y / len;
      }

      const score = network.gameStateRef.current?.players[myId]?.score ?? 0;
      const seq = predictInput(network.predictionRef.current, lastDir, boosting, score);
      socket.emit('input', { x: lastDir.x, y: lastDir.y, boost: boosting, seq });
    };

    const intervalId = window.setInterval(tickInput, TICK_MS);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [phase, network, windowSize.height, windowSize.width]);

  const returnToMenu = useCallback(() => {
    network.disconnect();
    setScore(0);
    setPhase('menu');
  }, [network]);

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
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const gameState = network.gameStateRef.current;
      const summary = network.worldSummaryRef.current;
      const myId = network.myIdRef.current;
      const me = myId && gameState ? gameState.players[myId] : null;

      if (phase !== 'playing' || !gameState || !me) {
        renderMenuScene(ctx, menuFoodsRef.current, windowSize.width, windowSize.height, time);
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, windowSize.width, windowSize.height);

      const nowTime = performance.now();
      const dt = Math.min((nowTime - lastRenderTime) / 1000, 0.1);
      lastRenderTime = nowTime;

      // Exponential Easing Smoothing
      const k = 16; // Easing factor (larger = faster catchup, lower latency)
      const lerpRate = 1 - Math.exp(-k * dt);
      // The local snake eases toward its (lag-free) predicted trail, so it can
      // track tighter than remote snakes without reintroducing network jitter.
      const selfLerpRate = 1 - Math.exp(-28 * dt);

      const prediction = network.predictionRef.current;

      for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        const isSelf =
          playerId === myId && prediction.initialized && prediction.segments.length > 0;
        const targetSegments = isSelf ? prediction.segments : player.segments;
        const rate = isSelf ? selfLerpRate : lerpRate;

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
            smooth.x += (target.x - smooth.x) * rate;
            smooth.y += (target.y - smooth.y) * rate;
          }
        }
      }

      const myHead = me.smoothSegments?.[0] || me.segments[0];
      const camera = {
        x: myHead.x - windowSize.width / 2,
        y: myHead.y - windowSize.height / 2,
        width: windowSize.width,
        height: windowSize.height,
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

      drawScore(ctx, me.score, windowSize.height);
      drawPlayerCount(ctx, summary.players.length, windowSize.height);
      drawLeaderboard(ctx, summary, myId, me.name, me.score, windowSize.width, leaderboardCache, now);
      drawMinimap(ctx, summary, myId, myHead, camera, gameState.worldSize);

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [network, phase, windowSize.height, windowSize.width]);

  const startGame = () => {
    network.resetGameRefs();
    setScore(0);
    setKilledBy(null);
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

        {phase === 'dead' && (
          <DeathScreen
            score={score}
            killedBy={killedBy}
            onPlayAgain={startGame}
            onMainMenu={returnToMenu}
          />
        )}
      </div>
    </div>
  );
}
