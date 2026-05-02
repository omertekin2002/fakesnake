export type Rgb = { r: number; g: number; b: number };

export const hueToHsl = (hue: number) => `hsl(${hue}, 80%, 60%)`;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export const hexToRgb = (hex: string): Rgb => {
  const normalized = hex.replace('#', '');
  const source = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const value = Number.parseInt(source, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const cssColorToRgb = (color: string): Rgb => {
  const rgbMatch = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgbMatch) {
    return {
      r: clampChannel(Number(rgbMatch[1])),
      g: clampChannel(Number(rgbMatch[2])),
      b: clampChannel(Number(rgbMatch[3])),
    };
  }

  return hexToRgb(color);
};

export const rgbToCss = ({ r, g, b }: Rgb): string => `rgb(${r}, ${g}, ${b})`;

export const mixColors = (from: string, to: string, amount: number): string => {
  const start = cssColorToRgb(from);
  const end = cssColorToRgb(to);
  const t = Math.max(0, Math.min(1, amount));

  return rgbToCss({
    r: Math.round(start.r + (end.r - start.r) * t),
    g: Math.round(start.g + (end.g - start.g) * t),
    b: Math.round(start.b + (end.b - start.b) * t),
  });
};

export const withAlpha = (hex: string, alpha: number): string => {
  const color = cssColorToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
};
