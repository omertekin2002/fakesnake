export function ConnectingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/28">
      <div className="rounded-md border border-white/10 bg-black/35 px-6 py-3 text-lg font-semibold text-white">
        Starting...
      </div>
    </div>
  );
}
