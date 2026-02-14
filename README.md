# Valentine RF - SigINT

An interactive 3D globe application for exploring and streaming radio receiver stations from around the world.

## Features

- **Interactive 3D Globe** — Drag, rotate, and zoom a Three.js globe with 1,517+ radio receiver stations plotted worldwide
- **Multi-dimensional Filtering** — Filter by receiver type (KiwiSDR, OpenWebRX, WebSDR), frequency band (HF, VHF, UHF, LF/MF, Airband, CB), continent, and region
- **Station Search** — Full-text search across all stations with keyboard shortcuts
- **Station Detail Panel** — View receiver info, embed receivers, and access station URLs
- **Military RF Intelligence Database** — 115+ military frequencies and 19 waveforms from sigidwiki.com, priyom.org, and radioreference.com
- **Frequency Cross-Reference** — Automatically matches military frequencies to each station's tuning range
- **Real-time Signal Intelligence** — Live SNR monitoring for KiwiSDR stations via `/status` and `/snr` endpoints
- **SigINT Logging** — Automatic signal data recording with timeline charts, peak/trough detection, and CSV export
- **Watchlist** — Background monitoring of selected stations with configurable polling intervals
- **Station Notes** — Write and save notes for watched stations
- **Alert System** — Configurable SNR threshold alerts with 8 customizable sounds and visual toast notifications
- **Favorites & Bookmarks** — Star stations for quick access, persisted in localStorage
- **Keyboard Navigation** — Arrow keys to cycle stations, Enter to select, Escape to deselect

## Tech Stack

- React 19 + TypeScript
- Three.js for 3D globe rendering
- Tailwind CSS 4 + Framer Motion
- Vite dev server

## Getting Started

```bash
pnpm install
pnpm dev
```

## Data Sources

- Station data from [receiverbook.de](https://www.receiverbook.de/map)
- Military RF data from [sigidwiki.com](https://www.sigidwiki.com), [priyom.org](https://priyom.org), [radioreference.com](https://wiki.radioreference.com)
