import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, Vector2, Player } from './shared/types';

const WORLD_SIZE = 3000;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [isDead, setIsDead] = useState(false);

  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    // Connect to the same host/port
    const newSocket = io(window.location.origin);
    setSocket(newSocket);

    newSocket.on('init', (data: { id: string; state: GameState }) => {
      setMyId(data.id);
      setGameState(data.state);
    });

    newSocket.on('update', (state: GameState) => {
      setGameState(state);
      if (newSocket.id && state.players[newSocket.id]) {
        setScore(state.players[newSocket.id].score);
      } else if (newSocket.id && !state.players[newSocket.id]) {
        setIsDead(true);
      }
    });

    newSocket.on('playerDied', (id: string) => {
      if (id === newSocket.id) {
        setIsDead(true);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !myId || isDead) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - windowSize.width / 2;
      const y = e.clientY - rect.top - windowSize.height / 2;

      // Send target direction
      socket.emit('input', { x, y });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [socket, myId, isDead]);

  // Render loop
  useEffect(() => {
    if (!canvasRef.current || !gameState || !myId) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const me = gameState.players[myId];
      
      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, windowSize.width, windowSize.height);

      if (!me) {
        // Draw death screen or waiting
        ctx.fillStyle = 'white';
        ctx.font = '30px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('You died! Refresh to respawn.', windowSize.width / 2, windowSize.height / 2);
        return;
      }

      const cameraX = me.segments[0].x - windowSize.width / 2;
      const cameraY = me.segments[0].y - windowSize.height / 2;

      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      // Draw grid
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      const gridSize = 50;
      const startX = Math.floor(cameraX / gridSize) * gridSize;
      const startY = Math.floor(cameraY / gridSize) * gridSize;
      
      for (let x = startX; x < cameraX + windowSize.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, cameraY);
        ctx.lineTo(x, cameraY + windowSize.height);
        ctx.stroke();
      }
      for (let y = startY; y < cameraY + windowSize.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(cameraX, y);
        ctx.lineTo(cameraX + windowSize.width, y);
        ctx.stroke();
      }

      // Draw world bounds
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 5;
      ctx.strokeRect(0, 0, WORLD_SIZE, WORLD_SIZE);

      // Draw food
      for (const foodId in gameState.foods) {
        const food = gameState.foods[foodId];
        // Only draw if visible
        if (
          food.position.x > cameraX - 20 &&
          food.position.x < cameraX + windowSize.width + 20 &&
          food.position.y > cameraY - 20 &&
          food.position.y < cameraY + windowSize.height + 20
        ) {
          ctx.fillStyle = food.color;
          ctx.beginPath();
          ctx.arc(food.position.x, food.position.y, 5 + food.value, 0, Math.PI * 2);
          ctx.fill();
          // Glow
          ctx.shadowBlur = 10;
          ctx.shadowColor = food.color;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Draw players
      for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        
        // Draw segments
        for (let i = player.segments.length - 1; i >= 0; i--) {
          const segment = player.segments[i];
          
          // Only draw if visible
          if (
            segment.x > cameraX - 30 &&
            segment.x < cameraX + windowSize.width + 30 &&
            segment.y > cameraY - 30 &&
            segment.y < cameraY + windowSize.height + 30
          ) {
            ctx.fillStyle = player.color;
            ctx.beginPath();
            const radius = i === 0 ? 15 : 12; // Head is slightly larger
            ctx.arc(segment.x, segment.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw eyes on head
            if (i === 0) {
              ctx.fillStyle = 'white';
              const eyeOffset = 5;
              ctx.beginPath();
              ctx.arc(segment.x - eyeOffset, segment.y - eyeOffset, 4, 0, Math.PI * 2);
              ctx.arc(segment.x + eyeOffset, segment.y - eyeOffset, 4, 0, Math.PI * 2);
              ctx.fill();
              
              ctx.fillStyle = 'black';
              ctx.beginPath();
              ctx.arc(segment.x - eyeOffset, segment.y - eyeOffset, 2, 0, Math.PI * 2);
              ctx.arc(segment.x + eyeOffset, segment.y - eyeOffset, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        
        // Draw name
        const head = player.segments[0];
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

      // UI overlay
      ctx.fillStyle = 'white';
      ctx.font = '20px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`Score: ${me.score}`, 20, 30);
      
      // Leaderboard
      const sortedPlayers = (Object.values(gameState.players) as Player[]).sort((a, b) => b.score - a.score).slice(0, 5);
      ctx.textAlign = 'right';
      ctx.fillText('Leaderboard', windowSize.width - 20, 30);
      ctx.font = '16px Arial';
      sortedPlayers.forEach((p, index) => {
        ctx.fillStyle = p.id === myId ? 'yellow' : 'white';
        ctx.fillText(`${index + 1}. ${p.name}: ${p.score}`, windowSize.width - 20, 60 + index * 25);
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState, myId]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white font-sans overflow-hidden">
      <div className="relative w-full h-screen overflow-hidden">
        <canvas
          ref={canvasRef}
          width={windowSize.width}
          height={windowSize.height}
          className="bg-[#1a1a1a] cursor-crosshair block"
        />
        
        {isDead && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm">
            <h2 className="text-5xl font-bold text-red-500 mb-4">Game Over</h2>
            <p className="text-xl mb-8">Final Score: {score}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-semibold transition-colors"
            >
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
