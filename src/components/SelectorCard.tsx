import React from 'react';

export type SelectorOption<K extends string> = {
  id: K;
  label: string;
  description: string;
  preview?: React.ReactNode;
};

type SelectorCardProps<K extends string> = {
  title: string;
  options: SelectorOption<K>[];
  selectedId: K;
  onSelect: (id: K) => void;
};

export function SelectorCard<K extends string>({
  title,
  options,
  selectedId,
  onSelect,
}: SelectorCardProps<K>) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-white/45">{title}</p>
      <div className="grid gap-2">
        {options.map((option) => {
          const isSelected = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                isSelected
                  ? 'border-white/35 bg-white/10'
                  : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/6'
              }`}
            >
              {option.preview}
              <div className="text-sm font-semibold text-white">{option.label}</div>
              <div className="text-xs text-white/50">{option.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
