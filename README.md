 <div align="center">

# 🔥 NASA FIRMS & OSM Thermal Intelligence
### AI-Based Detection & Probabilistic Classification of Industrial Fires & Persistent Thermal Sources

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Edge-F38020.svg?style=flat-square&logo=cloudflare)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?style=flat-square&logo=react)](https://react.dev/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900.svg?style=flat-square&logo=leaflet)](https://leafletjs.com/)
[![Copernicus Sentinel-2](https://img.shields.io/badge/Copernicus-Sentinel--2_L2A-002B49.svg?style=flat-square)](https://dataspace.copernicus.eu/)

*A full-stack, edge-deployed geospatial platform that fuses satellite thermal anomalies, OpenStreetMap land classifications, heavy infrastructure datasets, and Sentinel-2 optical imagery to classify thermal events across the Indian Subcontinent.*

</div>

---

## 🚀 Key Features

* 🛰️ **NASA FIRMS Satellite Ingestion**: Real-time integration with VIIRS (NOAA-20 / Suomi-NPP) and MODIS thermal sensor feeds covering sovereign Indian landmass and island territories.
* 🧠 **Multi-Class Probabilistic Inference**: Softmax classifier evaluating 5 event categories (`Industrial Flare`, `Crop Residue Burning`, `Forest Fire / Wildfire`, `Urban / Off-Target Source`, `Unknown / Low Confidence`).
* 🏭 **Infrastructure Proximity Engine**: Real-time spatial matching against **1,589 Indian power generation facilities & refineries** within a $2.5\text{ km}$ radius.
* 📷 **On-Demand Sentinel-2 High-Res Optical Imagery**: On-demand fetching of $1\times 1\text{ km}^2$ True-Color (RGB) optical imagery via Copernicus CDSE APIs with OAuth2 token reuse, catalog cloud coverage optimization, and D1 Base64 caching.
* 🗺️ **Categorical Leaflet Heatmaps & Sovereign Boundary**: Full-viewport map overlay with official Survey of India boundary lines (`in.json`), color-coded categorical markers (Indigo for Industrial, Gold for Agriculture, Red for Forest, Cyan for Water), and a floating glassmorphism legend.
* 📈 **Minimal Spatiotemporal Trajectory Analysis**: Historical $1.5\text{ km}$ spatial trajectory multi-line charts powered by `@nivo/line`, tracking persistence and Radiometric FRP evolution over time.
* ⚡ **Edge-Native Cloudflare Stack**: Powered by Hono, Cloudflare D1 (SQLite), Drizzle ORM, and React with sub-millisecond response times.

---

## 🏗️ Architecture & Monorepo Structure

```
nasa-firms/
├── apps/
│   ├── api/             # Hono REST API running on Cloudflare Workers / D1
│   └── web/             # Remix / Vite client application with Leaflet & Nivo
│
└── packages/
    ├── data/            # D1 Schema, Firms Queries, OSM Queries, Sentinel-2 Queries, Power Plants asset
    ├── core/            # Shared business models & domain services
    ├── shared/          # Common types & utilities
    └── config/          # Monorepo TypeScript & toolchain configs
```

---

## 🔬 Probabilistic Event Estimation Logic

The classification engine synthesizes multiple spatial, temporal, and radiometric feature drivers:

| Event Class | Primary Feature Drivers |
| :--- | :--- |
| **Industrial Routine Heat** | Stationary detection (`type = 2`), $\le 2.5\text{ km}$ from power plant / refinery, nighttime persistence. |
| **Crop Residue Burning** | Daytime acquisition ($06:00\text{--}18:00\text{ UTC}$), moderate FRP ($3\text{--}25\text{ MW}$), OSM `farmland` / `agricultural` tags. |
| **Forest Fire / Wildfire** | High FRP ($\ge 25\text{ MW}$), high brightness temperature ($> 330\text{ K}$), OSM `forest` / `woodland` tags. |
| **Urban / Off-Target** | Low FRP ($< 3\text{ MW}$), nighttime acquisition, OSM `urban` / `residential` tags. |
| **Unknown / Ambiguous** | Low signal confidence or conflicting radiometric indicators. |

---

## 🛠️ Quickstart & Local Development

### 1. Prerequisites
- Node.js 18+ and `pnpm`
- Cloudflare Wrangler CLI (`npx wrangler`)

### 2. Installation

Make a folder and run:

```bash
# Clone the repository
git clone https://github.com/aakware/SIH26162.git .

# Install workspace dependencies
pnpm install
```

### 3. Environment Setup
Configure API environment variables in `apps/api/.dev.vars`:
```env
NASA_MAPS_API_KEY="your_nasa_firms_api_key"
COPERNICUS_CLIENT_ID="your_copernicus_client_id"
COPERNICUS_CLIENT_SECRET="your_copernicus_client_secret"
```

### 4. Database Setup
```bash
# Generate and apply D1 migrations
pnpm --filter @repo/data db:generate
pnpm --filter @repo/data db:migrate:local
```

### 5. Start Development Servers
```bash
# Run API and Web apps concurrently
pnpm dev
```
- **Web App**: `http://localhost:5173`
- **Hono Edge API**: `http://localhost:8787`

---

## 📡 API Endpoints Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/anomalies/today` | Retrieves today's heat anomalies from D1 / NASA FIRMS API. |
| `GET` | `/api/anomalies/land-info?lat=...&lon=...` | Overpass API OSM land classification with D1 caching. |
| `GET` | `/api/anomalies/classify-event?lat=...&lon=...` | Probabilistic multi-class Bayesian event estimation. |
| `GET` | `/api/anomalies/spatial-history?lat=...&lon=...` | Historical $1.5\text{ km}$ spatial trajectory timeline. |
| `GET` | `/api/anomalies/sentinel-imagery?lat=...&lon=...` | On-demand $1\times 1\text{ km}^2$ Sentinel-2 optical image fetch & D1 cache. |

---

<div align="center">
Developed for NTRO SIH 26162
</div>
