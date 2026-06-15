import { Player, Vector2 } from '../shared/types';

// ── Entity interpolation for REMOTE snakes ───────────────────────────────────
// We can't predict other players' input, so instead of easing toward their
// (jittery, latency-delayed) latest authoritative position, we buffer their
// recent authoritative trails and render them a fixed delay in the past,
// interpolating between the two snapshots that bracket that render time. This
// decouples display from packet arrival, so remote snakes glide smoothly even
// when deltas arrive irregularly. The local snake uses prediction instead.

type Snapshot = { t: number; segments: Vector2[] };
export type InterpBuffer = Map<string, Snapshot[]>;

// Render this many ms in the past — enough headroom to always have a snapshot
// on each side of the render time despite network jitter (~3 ticks at 30Hz).
export const INTERP_DELAY_MS = 100;

// ~0.5s of history at 30Hz; plenty for the delay window.
const MAX_SNAPSHOTS = 16;

export const createInterpBuffer = (): InterpBuffer => new Map();

export const recordSnapshot = (
  buffer: InterpBuffer,
  playerId: string,
  segments: Vector2[],
  t: number,
): void => {
  let snapshots = buffer.get(playerId);
  if (!snapshots) {
    snapshots = [];
    buffer.set(playerId, snapshots);
  }
  snapshots.push({ t, segments: segments.map((s) => ({ x: s.x, y: s.y })) });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
};

export const removeInterpPlayer = (buffer: InterpBuffer, playerId: string): void => {
  buffer.delete(playerId);
};

// Grow/shrink smoothSegments to `len`, reusing existing point objects.
const ensureLength = (player: Player, len: number): Vector2[] => {
  if (!player.smoothSegments) player.smoothSegments = [];
  const ss = player.smoothSegments;
  while (ss.length < len) ss.push({ x: 0, y: 0 });
  if (ss.length > len) ss.length = len;
  return ss;
};

const writeFrom = (player: Player, src: Vector2[]): void => {
  const ss = ensureLength(player, src.length);
  for (let i = 0; i < src.length; i++) {
    ss[i].x = src[i].x;
    ss[i].y = src[i].y;
  }
};

const writeLerp = (player: Player, a: Vector2[], b: Vector2[], frac: number): void => {
  // Interpolate index-matched (segment i = i-th from head in both snapshots).
  // Lengths differ by at most a segment or two between adjacent ticks; render
  // the newer snapshot's length and snap the few unmatched tail points.
  const ss = ensureLength(player, b.length);
  for (let i = 0; i < b.length; i++) {
    if (i < a.length) {
      ss[i].x = a[i].x + (b[i].x - a[i].x) * frac;
      ss[i].y = a[i].y + (b[i].y - a[i].y) * frac;
    } else {
      ss[i].x = b[i].x;
      ss[i].y = b[i].y;
    }
  }
};

// Fill player.smoothSegments with the snake's interpolated pose at renderTime.
export const writeInterpolatedSnake = (
  buffer: InterpBuffer,
  playerId: string,
  renderTime: number,
  player: Player,
): void => {
  const snapshots = buffer.get(playerId);
  if (!snapshots || snapshots.length === 0) {
    writeFrom(player, player.segments); // no history yet — snap to authoritative
    return;
  }

  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];
  if (renderTime <= oldest.t) {
    writeFrom(player, oldest.segments);
    return;
  }
  if (renderTime >= newest.t) {
    writeFrom(player, newest.segments); // buffer underrun — hold newest
    return;
  }

  for (let i = 0; i < snapshots.length - 1; i++) {
    const a = snapshots[i];
    const b = snapshots[i + 1];
    if (a.t <= renderTime && renderTime <= b.t) {
      const span = b.t - a.t;
      writeLerp(player, a.segments, b.segments, span > 0 ? (renderTime - a.t) / span : 0);
      return;
    }
  }
};
