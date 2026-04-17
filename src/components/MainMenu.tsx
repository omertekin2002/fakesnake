import { SnakeAppearance } from '../shared/skins';
import { SkinPreview, SkinSelectors } from './SkinCustomizer';

type MainMenuProps = {
  playerName: string;
  onNameChange: (name: string) => void;
  appearance: SnakeAppearance;
  onAppearanceChange: (next: SnakeAppearance) => void;
  onStart: () => void;
};

export function MainMenu({
  playerName,
  onNameChange,
  appearance,
  onAppearanceChange,
  onStart,
}: MainMenuProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/12">
      <div className="flex w-full max-w-5xl flex-col items-center gap-6 px-6 py-10 text-center">
        <h1 className="text-5xl font-black uppercase tracking-[0.22em] text-white sm:text-7xl [text-shadow:0_0_30px_rgba(16,185,129,0.35)]">
          Lil Snake Game
        </h1>
        <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-black/45 px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-sm">
          <div className="flex flex-col gap-5">
            <SkinPreview appearance={appearance} />

            <input
              type="text"
              value={playerName}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onStart();
              }}
              placeholder="Enter your name"
              maxLength={16}
              className="mx-auto w-full max-w-sm rounded-2xl border border-white/20 bg-black/40 px-4 py-3 text-center text-lg text-white placeholder-white/40 outline-none focus:border-emerald-400/60"
            />

            <SkinSelectors appearance={appearance} onChange={onAppearanceChange} />
          </div>
        </div>
        <button
          id="start-btn"
          type="button"
          onClick={onStart}
          className="rounded-2xl border border-emerald-300/35 bg-emerald-500 px-10 py-3 text-lg font-semibold text-white transition hover:bg-emerald-400"
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
