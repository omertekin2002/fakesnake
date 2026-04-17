type ExitButtonProps = {
  onClick: () => void;
};

export function ExitButton({ onClick }: ExitButtonProps) {
  return (
    <button
      onClick={onClick}
      className="absolute left-5 top-5 rounded-md border border-white/15 bg-black/40 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/60"
    >
      Exit
    </button>
  );
}
