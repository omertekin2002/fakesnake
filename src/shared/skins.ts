export type SnakePalettePreset = {
  label: string;
  description: string;
  primary: string;
  secondary: string;
  stripe: string;
  highlight: string;
  foodHue: number;
};

export type SnakePatternPreset = {
  label: string;
  description: string;
  mode: 'bands' | 'tiger' | 'saddle' | 'racer';
};

export type SnakeTaperPreset = {
  label: string;
  description: string;
  tailScale: number;
  curve: number;
};

export const SNAKE_PALETTE_PRESETS = {
  sunflare: {
    label: 'Sunflare',
    description: 'Gold scales with bright citrus contrast.',
    primary: '#f4df3f',
    secondary: '#d88c18',
    stripe: '#fff7a8',
    highlight: '#fffbe0',
    foodHue: 52,
  },
  jade: {
    label: 'Jade',
    description: 'Cool emerald body with mint highlights.',
    primary: '#44cf75',
    secondary: '#167d56',
    stripe: '#bff6ca',
    highlight: '#ecfff1',
    foodHue: 142,
  },
  coral: {
    label: 'Coral',
    description: 'Warm salmon body with cream accents.',
    primary: '#ff8f6a',
    secondary: '#c74e48',
    stripe: '#ffd1bf',
    highlight: '#fff0ea',
    foodHue: 13,
  },
  abyss: {
    label: 'Abyss',
    description: 'Deep blue body with electric aqua bands.',
    primary: '#2d8cff',
    secondary: '#123d89',
    stripe: '#78efff',
    highlight: '#dff9ff',
    foodHue: 210,
  },
  amethyst: {
    label: 'Amethyst',
    description: 'Royal violet body with soft lavender shine.',
    primary: '#8f5cff',
    secondary: '#48298e',
    stripe: '#dfc7ff',
    highlight: '#f5ecff',
    foodHue: 268,
  },
} satisfies Record<string, SnakePalettePreset>;

export type SnakePaletteId = keyof typeof SNAKE_PALETTE_PRESETS;

export const SNAKE_PATTERN_PRESETS = {
  bands: {
    label: 'Bands',
    description: 'Clean alternating scale rings.',
    mode: 'bands',
  },
  tiger: {
    label: 'Tiger',
    description: 'Irregular broken stripes.',
    mode: 'tiger',
  },
  saddle: {
    label: 'Saddle',
    description: 'Chunkier wrapped patches.',
    mode: 'saddle',
  },
  racer: {
    label: 'Racer',
    description: 'Thin fast center-line rhythm.',
    mode: 'racer',
  },
} satisfies Record<string, SnakePatternPreset>;

export type SnakePatternId = keyof typeof SNAKE_PATTERN_PRESETS;

export const SNAKE_TAPER_PRESETS = {
  classic: {
    label: 'Classic',
    description: 'Gentle taper with a sturdy tail.',
    tailScale: 0.52,
    curve: 0.95,
  },
  viper: {
    label: 'Viper',
    description: 'Sharper taper for a lean silhouette.',
    tailScale: 0.34,
    curve: 1.15,
  },
  whip: {
    label: 'Whip',
    description: 'Aggressive tail taper toward the tip.',
    tailScale: 0.22,
    curve: 1.35,
  },
} satisfies Record<string, SnakeTaperPreset>;

export type SnakeTaperId = keyof typeof SNAKE_TAPER_PRESETS;

export type SnakeAppearance = {
  paletteId: SnakePaletteId;
  patternId: SnakePatternId;
  taperId: SnakeTaperId;
};

export const SNAKE_PALETTE_IDS = Object.keys(SNAKE_PALETTE_PRESETS) as SnakePaletteId[];
export const SNAKE_PATTERN_IDS = Object.keys(SNAKE_PATTERN_PRESETS) as SnakePatternId[];
export const SNAKE_TAPER_IDS = Object.keys(SNAKE_TAPER_PRESETS) as SnakeTaperId[];

export const DEFAULT_SNAKE_APPEARANCE: SnakeAppearance = {
  paletteId: 'sunflare',
  patternId: 'bands',
  taperId: 'classic',
};

const randomChoice = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

export const createRandomSnakeAppearance = (): SnakeAppearance => ({
  paletteId: randomChoice(SNAKE_PALETTE_IDS),
  patternId: randomChoice(SNAKE_PATTERN_IDS),
  taperId: randomChoice(SNAKE_TAPER_IDS),
});

const isSnakePaletteId = (value: unknown): value is SnakePaletteId =>
  typeof value === 'string' && value in SNAKE_PALETTE_PRESETS;

const isSnakePatternId = (value: unknown): value is SnakePatternId =>
  typeof value === 'string' && value in SNAKE_PATTERN_PRESETS;

const isSnakeTaperId = (value: unknown): value is SnakeTaperId =>
  typeof value === 'string' && value in SNAKE_TAPER_PRESETS;

export const normalizeSnakeAppearance = (value: unknown): SnakeAppearance => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SNAKE_APPEARANCE };
  }

  const maybeAppearance = value as Partial<SnakeAppearance>;
  return {
    paletteId: isSnakePaletteId(maybeAppearance.paletteId)
      ? maybeAppearance.paletteId
      : DEFAULT_SNAKE_APPEARANCE.paletteId,
    patternId: isSnakePatternId(maybeAppearance.patternId)
      ? maybeAppearance.patternId
      : DEFAULT_SNAKE_APPEARANCE.patternId,
    taperId: isSnakeTaperId(maybeAppearance.taperId)
      ? maybeAppearance.taperId
      : DEFAULT_SNAKE_APPEARANCE.taperId,
  };
};

export const getSnakePalette = (paletteId: SnakePaletteId): SnakePalettePreset =>
  SNAKE_PALETTE_PRESETS[paletteId];

export const getSnakePattern = (patternId: SnakePatternId): SnakePatternPreset =>
  SNAKE_PATTERN_PRESETS[patternId];

export const getSnakeTaper = (taperId: SnakeTaperId): SnakeTaperPreset =>
  SNAKE_TAPER_PRESETS[taperId];
