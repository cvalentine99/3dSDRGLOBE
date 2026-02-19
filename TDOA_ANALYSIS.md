# KiwiSDR TDoA Triangulation — Reverse Engineering Analysis & Integration Plan

## Executive Summary

The KiwiSDR TDoA (Time Difference of Arrival) system is a distributed geolocation service that uses **2–6 GPS-synchronized KiwiSDR receivers** to triangulate the physical location of an HF radio transmitter. The system works by simultaneously sampling IQ data from multiple receivers, computing cross-correlations to find time differences, and using those differences to generate probability heatmaps on a map.

The entire computation is orchestrated by a **central server** at `http://tdoa.kiwisdr.com` which runs Octave/MATLAB algorithms. Our integration can leverage this server directly or implement our own lightweight client-side approximation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TDoA Server (tdoa.kiwisdr.com)           │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ tdoa.php  │  │ kiwirecorder │  │ Octave TDoA Algorithm │ │
│  │ (submit)  │→ │ (IQ sampler) │→ │ (cross-correlation)   │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
│       ↑                                      ↓              │
│  Query params                        Result files:          │
│  (hosts, freq,                       - progress.json        │
│   sample time,                       - status.json          │
│   map bounds)                        - *_for_map.png        │
│                                      - *_contour_for_map.json│
│                                      - tdoa_data.mat        │
└─────────────────────────────────────────────────────────────┘
         ↑                                      ↓
    ┌────┴────┐                          ┌──────┴──────┐
    │ Client  │                          │   Results   │
    │ Browser │←─────────────────────────│  (heatmap,  │
    │         │   polling progress.json  │  contours,  │
    └─────────┘                          │  likely pos)│
         ↑                               └─────────────┘
    ┌────┴────────────────────────────┐
    │   GPS-Active KiwiSDR Hosts      │
    │   (492 receivers worldwide)     │
    │   kiwi.gps.json — live list     │
    └─────────────────────────────────┘
```

---

## Data Sources (Live APIs)

### 1. GPS-Active Host List
- **URL:** `http://tdoa.kiwisdr.com/tdoa/files/kiwi.gps.json`
- **Format:** JSON array of host objects
- **Update frequency:** Continuously updated by the TDoA server
- **Current count:** 492 GPS-active KiwiSDR receivers

**Host object fields:**

| Field | Type    | Description                                    |
|-------|---------|------------------------------------------------|
| `i`   | int     | Index in the list                              |
| `id`  | string  | Maidenhead grid locator (e.g., "JO50uw")       |
| `h`   | string  | Hostname (e.g., "erserver.ddns.net")           |
| `p`   | int     | Port (usually 8073)                            |
| `lat` | float   | GPS latitude                                   |
| `lon` | float   | GPS longitude                                  |
| `lo`  | int     | Low-resolution GPS flag (0=good, 1=low-res)    |
| `fm`  | int     | GPS fixes per minute                           |
| `u`   | int     | Current users connected                        |
| `um`  | int     | Maximum users allowed                          |
| `tc`  | int     | TDoA channels available                        |
| `snr` | int     | Signal-to-noise ratio                          |
| `v`   | string  | Firmware version (e.g., "1.829")               |
| `mac` | string  | MAC address                                    |
| `a`   | string  | Antenna description                            |
| `n`   | string  | Station name/description                       |

### 2. Reference Transmitter Database
- **URL:** `http://tdoa.kiwisdr.com/tdoa/refs.cjson`
- **Format:** CJSON (JSON with comments) — array of reference transmitter objects
- **Content:** Known transmitter locations (VLF/LF, milcom, radar, aero, marine, broadcast, utility, time/freq)

**Reference object fields:**

| Field | Type   | Description                                |
|-------|--------|--------------------------------------------|
| `r`   | string | Category codes (v=VLF/LF, m=milcom, etc.) |
| `id`  | string | Call sign / identifier                     |
| `t`   | string | Modulation type (MSK, FSK, etc.)           |
| `f`   | float  | Frequency in kHz                           |
| `p`   | int    | Passband width in Hz                       |
| `z`   | int    | Default zoom level                         |
| `lat` | float  | Latitude                                   |
| `lon` | float  | Longitude                                  |
| `mz`  | int    | Map zoom level (optional)                  |

### 3. Individual KiwiSDR Status
- **URL:** `http://{host}:{port}/status`
- **Format:** Key=value pairs, newline-separated
- **Key fields:** `offline`, `auth`, `users`, `users_max`, `preempt`, `fixes_min`, `gps`, `tdoa_id`, `tdoa_ch`, `snr`, `antenna`, `name`

---

## TDoA Submit Protocol

### Step 1: Submit Job
**Endpoint:** `http://tdoa.kiwisdr.com/php/tdoa.php`

**Query Parameters:**

| Param  | Format                          | Description                                           |
|--------|---------------------------------|-------------------------------------------------------|
| (auth) | `tdoa.a[0]` encoded token       | Authentication token from KiwiSDR server              |
| `key`  | 5-digit timestamp hash          | Unique job identifier                                 |
| `h`    | `host1,host2,...`               | Comma-separated hostnames                             |
| `p`    | `port1,port2,...`               | Comma-separated ports                                 |
| `id`   | `id1,id2,...`                   | Comma-separated station IDs                           |
| `f`    | float (kHz)                     | Center frequency                                      |
| `s`    | int (seconds)                   | Sample time (15, 30, 45, or 60)                       |
| `w`    | int (Hz)                        | Passband width                                        |
| `pi`   | Octave struct string            | Map bounds + known location + options                 |
| `rerun`| key string (optional)           | Reuse samples from previous run                       |

**Example `pi` parameter:**
```
struct('lat_range',\[40,60\],'lon_range',\[-10,30\],'known_location',struct('coord',\[48.85,2.35\],'name','Paris'),'new',true)
```

### Step 2: Poll Progress
**Endpoint:** `http://tdoa.kiwisdr.com/tdoa/files/{key}/progress.json`
- Polled every 2 seconds
- Timeout after 250 seconds

**Protocol sequence (sequential, each item processed once):**

| Seq | Field     | Description                                    |
|-----|-----------|------------------------------------------------|
| 0   | `key`     | Server confirms/assigns the job key            |
| 1   | `files`   | List of recorded IQ sample files               |
| 2   | `status0` | Bitmask of sampling status (2 bits per host)   |
| 3   | `done`    | Computation complete flag                      |

**Sampling status bits (per host, 2 bits):**
- `0` = sampling complete
- `1` = connection failed
- `2` = all channels in use
- `3` = no recent GPS timestamps

### Step 3: Retrieve Results
**Endpoint:** `http://tdoa.kiwisdr.com/tdoa/files/{key}/status.json`

**Result structure:**
```json
{
  "likely_position": { "lat": 48.85, "lng": 2.35 },
  "input": {
    "per_file": [
      { "name": "StationA", "status": "OK" },
      { "name": "StationB", "status": "BAD" }
    ],
    "result": { "status": "OK", "message": "" }
  },
  "constraints": {
    "result": { "status": "OK", "message": "" }
  }
}
```

### Step 4: Display Results
**Result files per pair:**
- `{id1}-{id2}_for_map.png` — Heatmap overlay image
- `{id1}-{id2}_contour_for_map.json` — Contour polygons/polylines with colors
- `TDoA map_for_map.png` — Combined TDoA heatmap
- `TDoA combined_for_map.png` — Combined overlay
- `tdoa_data.mat` — Raw MATLAB data file

**Contour JSON format:**
```json
{
  "imgBounds": { "north": 60, "south": 40, "east": 30, "west": -10 },
  "polygons": [[{"lat": 48.5, "lng": 2.3}, ...], ...],
  "polygon_colors": ["#ff0000", "#00ff00", ...],
  "polylines": [[{"lat": 48.5, "lng": 2.3}, ...], ...],
  "polyline_colors": ["#ff0000", ...]
}
```

---

## Integration Architecture for Radio Globe

### Option A: Full Server-Side TDoA (Recommended)

Leverage the existing `tdoa.kiwisdr.com` server to perform the actual computation. Our app acts as a modern frontend.

```
Radio Globe App
├── Server (tRPC procedures)
│   ├── tdoa.getGpsHosts()        → Fetch & cache kiwi.gps.json
│   ├── tdoa.getRefs()            → Fetch & parse refs.cjson
│   ├── tdoa.checkHostStatus()    → Proxy /status check for a host
│   ├── tdoa.submitJob()          → Proxy tdoa.php submit
│   ├── tdoa.pollProgress()       → Proxy progress.json polling
│   └── tdoa.getResults()         → Proxy status.json + result files
│
└── Client (React components)
    ├── TDoAPanel.tsx             → Main TDoA control panel
    │   ├── Host selector (pick 2-6 GPS KiwiSDRs from globe)
    │   ├── Frequency input + passband
    │   ├── Sample time selector (15/30/45/60s)
    │   ├── Known location input (optional reference)
    │   └── Submit / Stop / Rerun buttons
    │
    ├── TDoAGlobeOverlay.tsx      → Bearing lines + heatmap on 3D globe
    │   ├── Host markers (yellow = selected, blue = available)
    │   ├── Heatmap texture overlay (from PNG result)
    │   ├── Contour polygons (from JSON result)
    │   └── "Most likely position" marker with coordinates
    │
    ├── TDoAFallbackOverlay.tsx   → Same overlays on 2D FallbackMap
    │
    └── TDoAProgress.tsx          → Real-time progress display
        ├── Per-host sampling status (spinner → check/error)
        ├── Algorithm running indicator
        └── Result selector (combined / per-pair / dt maps)
```

### Option B: Client-Side Bearing Estimation (Lightweight)

For a simpler "quick estimate" mode that doesn't require the TDoA server:

1. User selects 2+ KiwiSDR receivers and a frequency
2. App opens each receiver's WebSocket to get IQ data
3. Client-side cross-correlation computes time delays
4. Time delays → hyperbolic curves drawn on the globe
5. Intersection of curves = estimated position

This is more complex to implement but works offline and gives instant visual feedback.

### Recommended Approach: Hybrid

- **Phase 1:** Implement Option A (server-proxied TDoA) — full accuracy, proven algorithm
- **Phase 2:** Add visual bearing lines from each selected host to the estimated position
- **Phase 3:** (Optional) Add client-side quick-estimate mode for instant feedback

---

## Implementation Plan

### Database Schema
```sql
CREATE TABLE tdoa_jobs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  frequency_khz DECIMAL(10,2) NOT NULL,
  passband_hz INT NOT NULL,
  sample_time INT NOT NULL DEFAULT 30,
  hosts JSON NOT NULL,           -- [{h, p, id, lat, lon}]
  known_location JSON,           -- {lat, lon, name}
  map_bounds JSON NOT NULL,      -- {lat_n, lat_s, lon_e, lon_w}
  tdoa_key VARCHAR(10),          -- server-assigned job key
  status ENUM('pending','sampling','computing','complete','error') DEFAULT 'pending',
  likely_lat DECIMAL(10,6),
  likely_lon DECIMAL(10,6),
  result_data JSON,              -- full status.json response
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);
```

### Key Technical Challenges

1. **Auth Token:** The TDoA server requires an auth token (`tdoa.a[0]`) that is generated by the KiwiSDR C++ backend from GPS data. We need to either:
   - Proxy through a KiwiSDR that has the TDoA extension enabled
   - Reverse-engineer the token generation (encoded GPS string)
   - Contact the TDoA server maintainer for API access

2. **Mixed Content:** The TDoA server runs on HTTP. Our HTTPS app needs a server-side proxy for all TDoA API calls.

3. **CORS:** The TDoA server has `Access-Control-Allow-Origin: *` so direct browser requests work, but we should still proxy for reliability.

4. **Result Visualization on 3D Globe:** The heatmap PNGs have geographic bounds and need to be projected as textures on the Three.js globe. Contour polygons need to be converted from lat/lon to 3D coordinates.

---

## Quick Start Implementation Order

1. **Fetch & display GPS-active hosts on the globe** (green markers for TDoA-capable receivers)
2. **Host selection UI** — click hosts to add to TDoA job (2-6 max)
3. **Frequency/passband input** with presets from the military RF database
4. **Server-side proxy** for tdoa.php submit + progress polling
5. **Real-time progress display** with per-host status
6. **Result heatmap overlay** on the 3D globe
7. **Contour polygon overlay** with color-coded probability zones
8. **"Most likely position" marker** with coordinates and Google Maps link
9. **Job history** — save and replay previous TDoA runs
10. **Bearing line visualization** — draw great-circle lines from each host through the estimated position
