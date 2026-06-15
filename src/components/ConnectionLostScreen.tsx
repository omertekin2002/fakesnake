type ConnectionLostScreenProps = {
  onReconnect: () => void;
  onMainMenu: () => void;
};

export function ConnectionLostScreen({ onReconnect, onMainMenu }: ConnectionLostScreenProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 backdrop-blur-sm">
      <h2 className="mb-2 text-4xl font-bold text-amber-400">Connection Lost</h2>
      <p className="mb-8 max-w-sm text-center text-white/70">
        Lost contact with the server. Your snake couldn&apos;t be saved &mdash; rejoin to
        start a fresh run.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={onReconnect}
          className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          Reconnect
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
