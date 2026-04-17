import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SNAKE_APPEARANCE, SnakeAppearance } from './shared/skins';
import { useGameNetwork } from './game/network';
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

const INPUT_THROTTLE_MS = 1000 / 30;
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

    let lastEmitTime = 0;
    const mousePos = { x: 0, y: 0 };
    let boosting = false;

    const emitInput = () => {
      network.socketRef.current?.emit('input', {
        x: mousePos.x,
        y: mousePos.y,
        boost: boosting,
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      mousePos.x = e.clientX - rect.left - windowSize.width / 2;
      mousePos.y = e.clientY - rect.top - windowSize.height / 2;

      const now = performance.now();
      if (now - lastEmitTime < INPUT_THROTTLE_MS) return;
      lastEmitTime = now;
      emitInput();
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        boosting = true;
        emitInput();
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        boosting = false;
        emitInput();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        boosting = true;
        emitInput();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        boosting = false;
        emitInput();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
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

      const interpMap = network.interpRef.current;
      const interpT = Math.min((time - network.lastDeltaTimeRef.current) / TICK_MS, 1);
      const lerpHead = (id: string, fallback: { x: number; y: number }) => {
        const s = interpMap.get(id);
        if (!s) return fallback;
        return {
          x: s.prevX + (s.currX - s.prevX) * interpT,
          y: s.prevY + (s.currY - s.prevY) * interpT,
        };
      };

      const myHead = lerpHead(myId!, me.segments[0]);
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
        const head = lerpHead(playerId, player.segments[0]);
        drawSnake(ctx, player, head, camera);
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
