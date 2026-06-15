type DeathScreenProps = {
  score: number;
  killedBy: string | null;
  bestScore: number;
  isNewBest: boolean;
  onPlayAgain: () => void;
  onMainMenu: () => void;
};

export function DeathScreen({
  score,
  killedBy,
  bestScore,
  isNewBest,
  onPlayAgain,
  onMainMenu,
}: DeathScreenProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 backdrop-blur-sm">
      <h2 className="mb-2 text-5xl font-bold text-red-500">Game Over</h2>
      {killedBy && (
        <p className="mb-2 text-lg text-red-300/80">
          Killed by {killedBy}
        </p>
      )}
      <p className="mb-1 text-xl">Final Score: {score}</p>
      <p className="mb-8 text-sm font-semibold text-amber-300">
        {isNewBest ? '🏆 New personal best!' : `Best: ${bestScore}`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={onPlayAgain}
          className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          Play Again
        </button>
        <button
          onClick={onMainMenu}
          className="rounded-md bg-white/10 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/20"
        >
          Main Menu
        </button>
      </div>
    </div>
  );
}
