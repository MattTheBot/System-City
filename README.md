# System City — Open Source Browser City Builder

> A 3D city builder that runs entirely in your browser. No install. No GPU required. Inspired by the depth of Cities: Skylines and the clarity of TheoTown — built with Babylon.js and WebGL.

![Status](https://img.shields.io/badge/status-early%20development-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Contributions](https://img.shields.io/badge/contributions-welcome-brightgreen)

**[▶ Play in browser](https://yourusername.github.io/skyblock-city)** · [Report a bug](../../issues) · [Suggest a feature](../../issues) · [Join the discussion](../../discussions)

---

## What is this?

Skyblock City is a free, open-source 3D city builder that plays entirely in the browser. You zone land, build roads (including curves), manage power and water, collect taxes, and watch your city grow — all without downloading anything.

**Design goals:**
- CS1-style freeform curved road placement with snap-to-node intersections
- TheoTown-style RCI demand system (residential, commercial, industrial)
- Low-poly 3D graphics that run on integrated graphics (no dedicated GPU needed)
- Terrain loaded from heightmap PNGs — share custom maps as image files
- Fully open source and moddable via JSON building definitions

---

## Current status

This project is in early development. Here's what works right now:

- [ ] 3D terrain from heightmap
- [ ] Camera pan / orbit / zoom
- [ ] Tile selection and highlighting
- [ ] Road placement (straight)
- [ ] Zone painting (R / C / I)
- [ ] Buildings spawn on zoned tiles
- [ ] Basic UI panel

See the [milestone roadmap](#roadmap) below for what's coming.

---

## Play it now

Open [this link](https://yourusername.github.io/skyblock-city) in any modern browser. Works on Chrome, Firefox, Edge. Works on Chromebooks. No GPU required — runs on Intel integrated graphics.

---

## How to run locally

```bash
# Clone the repo
git clone https://github.com/yourusername/skyblock-city.git
cd skyblock-city

# Option A — no install needed, just open the file
# Open index.html directly in your browser (some features need a local server)

# Option B — with a local server (recommended)
npx serve .
# Then open http://localhost:3000
```

That's it. No build step required to get started.

---

## How to contribute

Contributions of all kinds are welcome — you don't need to be an experienced programmer.

**Easy ways to contribute (no coding needed):**
- Add a new building definition (JSON file in `/buildings/`) — see [Adding Buildings](docs/adding-buildings.md)
- Create or improve a building mesh (GLB file) — see [Art Guidelines](docs/art-guidelines.md)
- Share a custom map (heightmap PNG) in `/maps/community/`
- Improve translations in `/locale/`
- Report bugs or suggest features in [Issues](../../issues)

**Code contributions:**
- Check [Issues](../../issues) for anything labelled `good first issue`
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR
- The simulation logic lives in `/src/sim/` — pure JavaScript, no 3D knowledge needed
- The rendering code lives in `/src/render/` — Babylon.js

**Before submitting a PR:**
1. Make sure the game still loads in a browser
2. If you changed simulation logic, describe what changed in your PR
3. Keep PRs focused — one feature or fix per PR

---

## Roadmap

### Milestone 1 — The blank canvas *(weeks 1–3)*
3D terrain, working camera, GitHub Pages deploy

### Milestone 2 — Place things *(weeks 4–7)*
Road placement, zone painting, buildings appear, bulldoze tool, basic UI

### Milestone 3 — The city lives *(months 2–3)*
Population, RCI demand bars, building upgrades, power grid, water, budget, save/load

### Milestone 4 — Curved roads *(months 3–4)*
Bézier spline roads, snap-to-node intersections, "available plot" zones generate alongside roads

### Milestone 5 — It looks alive *(months 4–6)*
Decorative cars, water simulation, more buildings, parks, services, day/night cycle

### Milestone 6 — Community *(months 6–12)*
JSON mod system, disaster events (fire), mobile touch support, contributor documentation

---

## Tech stack

| Layer | Technology |
|---|---|
| 3D rendering | [Babylon.js](https://babylonjs.com) (WebGL/WebGPU) |
| Simulation | Vanilla JavaScript, Web Workers |
| UI | HTML + CSS |
| Hosting | GitHub Pages |
| Assets | [Kenney.nl](https://kenney.nl) CC0 low-poly assets + community GLB files |
| Terrain | Heightmap PNG (paint in any terrain editor, export PNG, load in game) |

---

## Building definitions

Buildings are defined in plain JSON. Anyone can add a new building without touching the engine:

```json
{
  "id": "res_house_small",
  "name": "Small House",
  "zone": "residential",
  "level": 1,
  "size": [1, 1],
  "capacity": 4,
  "cost": 200,
  "upkeep": 5,
  "mesh": "buildings/res_house_small.glb",
  "upgrades_to": "res_house_medium"
}
```

See [docs/adding-buildings.md](docs/adding-buildings.md) for the full spec.

---

## Custom maps

Maps are grayscale heightmap PNGs. White = highest point, black = lowest. To share a map:
1. Paint a heightmap in any terrain editor (or generate one with noise)
2. Export as a 512×512 or 1024×1024 PNG
3. Drop it in `/maps/community/` and open a PR

---

## Licence

MIT. Use it, fork it, build on it. If you make something cool, please share it back.

---

## Acknowledgements

- [Babylon.js](https://babylonjs.com) — 3D engine
- [Kenney.nl](https://kenney.nl) — CC0 3D assets
- [TheoTown](https://theotown.com) — design inspiration for the RCI demand system
- [Cities: Skylines](https://www.citiesskylines.com) — inspiration for road mechanics
- Everyone who opens an issue, submits a PR, or shares the project
