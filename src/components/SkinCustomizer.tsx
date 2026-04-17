import {
  getSnakePalette,
  getSnakePattern,
  getSnakeTaper,
  SnakeAppearance,
  SnakePaletteId,
  SnakePatternId,
  SnakeTaperId,
  SNAKE_PALETTE_IDS,
  SNAKE_PATTERN_IDS,
  SNAKE_TAPER_IDS,
} from '../shared/skins';
import { mixColors, withAlpha } from '../game/render/colors';
import { getSegmentColor, getSegmentRadius } from '../game/render/snake';
import { SelectorCard, SelectorOption } from './SelectorCard';

type SkinPreviewProps = {
  appearance: SnakeAppearance;
};

export function SkinPreview({ appearance }: SkinPreviewProps) {
  const palette = getSnakePalette(appearance.paletteId);
  const pattern = getSnakePattern(appearance.patternId);
  const taper = getSnakeTaper(appearance.taperId);

  const previewSegments = Array.from({ length: 8 }, (_, index) => {
    const segmentIndex = index + 1;
    const radius = getSegmentRadius(segmentIndex, 9, appearance, 15);
    const color = getSegmentColor(segmentIndex, 9, appearance);

    return {
      key: `preview-${segmentIndex}`,
      color,
      size: radius * 2,
      left: 58 + index * 24,
      top: 34 - radius,
    };
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Snake Preview</p>
      <div className="relative h-20 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/30">
        <div
          className="absolute left-8 rounded-full"
          style={{
            top: 20,
            width: 30,
            height: 30,
            background: `radial-gradient(circle at 32% 28%, ${palette.highlight} 0%, ${mixColors(palette.primary, palette.stripe, 0.28)} 62%, ${mixColors(palette.secondary, '#050505', 0.2)} 100%)`,
            boxShadow: `0 0 24px ${withAlpha(palette.primary, 0.28)}`,
          }}
        />
        {previewSegments.map((segment) => (
          <div
            key={segment.key}
            className="absolute rounded-full"
            style={{
              left: segment.left,
              top: segment.top,
              width: segment.size,
              height: segment.size,
              background: `radial-gradient(circle at 32% 28%, ${mixColors(segment.color, palette.highlight, 0.72)} 0%, ${segment.color} 62%, ${mixColors(segment.color, '#050505', 0.28)} 100%)`,
              boxShadow: `0 0 18px ${withAlpha(segment.color, 0.18)}`,
            }}
          />
        ))}
      </div>
      <p className="text-sm text-white/65">
        {palette.label} · {pattern.label} · {taper.label}
      </p>
    </div>
  );
}

type SkinSelectorsProps = {
  appearance: SnakeAppearance;
  onChange: (next: SnakeAppearance) => void;
};

export function SkinSelectors({ appearance, onChange }: SkinSelectorsProps) {
  const paletteOptions: SelectorOption<SnakePaletteId>[] = SNAKE_PALETTE_IDS.map((paletteId) => {
    const palette = getSnakePalette(paletteId);
    return {
      id: paletteId,
      label: palette.label,
      description: palette.description,
      preview: (
        <div className="mb-2 flex gap-2">
          {[palette.primary, palette.secondary, palette.stripe].map((color) => (
            <span
              key={color}
              className="h-4 w-4 rounded-full border border-black/20"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      ),
    };
  });

  const patternOptions: SelectorOption<SnakePatternId>[] = SNAKE_PATTERN_IDS.map((patternId) => {
    const pattern = getSnakePattern(patternId);
    return { id: patternId, label: pattern.label, description: pattern.description };
  });

  const taperOptions: SelectorOption<SnakeTaperId>[] = SNAKE_TAPER_IDS.map((taperId) => {
    const taper = getSnakeTaper(taperId);
    return { id: taperId, label: taper.label, description: taper.description };
  });

  return (
    <div className="grid gap-4 text-left sm:grid-cols-3">
      <SelectorCard
        title="Palette"
        options={paletteOptions}
        selectedId={appearance.paletteId}
        onSelect={(paletteId) => onChange({ ...appearance, paletteId })}
      />
      <SelectorCard
        title="Pattern"
        options={patternOptions}
        selectedId={appearance.patternId}
        onSelect={(patternId) => onChange({ ...appearance, patternId })}
      />
      <SelectorCard
        title="Tail Shape"
        options={taperOptions}
        selectedId={appearance.taperId}
        onSelect={(taperId) => onChange({ ...appearance, taperId })}
      />
    </div>
  );
}
