type ConnectionLostScreenProps = {
  reason?: string | null;
  onReconnect: () => void;
  onMainMenu: () => void;
};

export function ConnectionLostScreen({ reason, onReconnect, onMainMenu }: ConnectionLostScreenProps) {
  // The server rejects over-capacity handshakes with "Too many connections
  // from this address" (per-IP cap) or "Server is full" (global cap); either
  // way it's a full server, not a dropped run, so say so distinctly.
  const normalizedReason = (reason ?? '').toLowerCase();
  const isIpCap = normalizedReason.includes('too many');
  const isFull = isIpCap || normalizedReason.includes('full');

  const title = isFull ? 'Server Full' : 'Connection Lost';
  const message = isIpCap
    ? 'Too many connections from your network right now. Wait a moment and try again.'
    : isFull
      ? 'The server is at capacity right now. Wait a moment and try again.'
      : "Lost contact with the server. Your snake couldn't be saved — rejoin to start a fresh run.";

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 backdrop-blur-sm">
      <h2 className="mb-2 text-4xl font-bold text-amber-400">{title}</h2>
      <p className="mb-8 max-w-sm text-center text-white/70">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={onReconnect}
          className="rounded-md bg-emerald-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          {isFull ? 'Try Again' : 'Reconnect'}
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
