# Lil Snake Game

A real-time multiplayer [slither.io](https://slither.io)-style snake game. An
authoritative Node server runs the simulation at 30Hz; a React + Canvas client
renders it with client-side prediction for smooth, responsive movement.

## Stack

- **Server** — a single `server.ts` (run with `tsx`) that is both the
  authoritative game loop (Express + [Socket.IO](https://socket.io)) and the web
  host (Vite middleware in dev, static `dist/` in production).
- **Client** — React 19 + TypeScript, Canvas 2D rendering, Tailwind CSS v4,
  bundled by Vite.

## Run locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev      # starts server + client on http://localhost:3000
```

Set `PORT` to change the port (e.g. `PORT=3100 npm run dev`).

### Production build

```bash
npm run build    # bundles the client into dist/
NODE_ENV=production npm start
```

## How to play

- **Move** — your snake follows the mouse cursor.
- **Boost** — hold the left mouse button or `Space` (costs length/score).
- **Goal** — eat food to grow; make other snakes' heads run into your body.
  Hitting the world border or another snake's body kills you.
- `Esc` returns to the menu.

The world auto-fills with bots so there's always something to play against.

## Architecture

- **Authoritative server**: the server owns all game state and steps a
  fixed-timestep simulation at 30Hz (`server.ts`). Clients send input; the
  server resolves movement, food, and collisions.
- **Delta protocol**: per tick the server sends compact deltas
  (`{ newHead, removeTail, ... }`) rather than full snake bodies, culled to each
  client's area of interest (AOI).
- **Client-side prediction**: the local snake is simulated immediately from
  input using the shared physics in `src/shared/` and reconciled against the
  server each tick (`src/game/prediction.ts`). Remote snakes are smoothed with
  an interpolation buffer.

```
src/
  shared/      types, physics constants, and movement shared by client + server
  game/        network layer, prediction, and Canvas renderers
  components/   React UI (menu, HUD overlays, death screen)
server.ts      authoritative simulation + web host
```

## Tests

```bash
npm test        # vitest — covers shared physics and prediction reconciliation
```

## Deploy

Configured for [Render](https://render.com) via `render.yaml` (health check at
`/api/health`).
