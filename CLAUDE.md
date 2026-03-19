# CLAUDE.md — SparkLoom

## Project Overview

SparkLoom is a free ($0/month) Loom clone for personal use on macOS Apple Silicon. It records screen + webcam + audio, uploads segments in real-time to Cloudflare, and provides AI-powered transcription and summaries — all at zero cost.

## Architecture

- **Desktop app**: Tauri v2 (Rust backend + React/TypeScript frontend in WebView)
- **Backend**: Cloudflare Workers (Hono) + R2 (video storage) + D1 (SQLite metadata)
- **Web viewer**: Cloudflare Pages (React + hls.js)
- **AI**: whisper-rs 0.16 with Metal GPU (transcription) + Ollama/Qwen 3.5 4B (local summaries)

## Monorepo Structure

```
sparkloom/
├── apps/desktop/          # Tauri v2 app (Rust + React)
│   ├── src/               # Rust code (capture, encoding, upload, transcription)
│   ├── ui/                # React frontend (Vite + TypeScript)
│   └── tauri.conf.json    # Tauri config
├── apps/web/              # Web viewer (Cloudflare Pages)
├── packages/shared/       # Shared TypeScript types
├── workers/               # Cloudflare Workers API (Hono)
└── scripts/               # Setup & utility scripts
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | Tauri v2 | Lightweight, Rust core, proven by Cap.so |
| Frontend | React 19 + Vite 6 + Tailwind 4 | Fast DX, simple |
| State | Zustand 5 | Minimal boilerplate |
| Screen capture | screencapturekit-rs | Native Apple ScreenCaptureKit bindings |
| HW encoding | VideoToolbox (objc2) | Zero-cost HEVC on Apple Silicon |
| Transcription | whisper-rs 0.16 (Metal) | On-device, fast, free |
| Summaries | Ollama + Qwen 3.5 4B | Local LLM, free, 3.4GB |
| API | Cloudflare Workers + Hono | 100K req/day free |
| Video storage | Cloudflare R2 | 10GB free + free egress |
| Database | Cloudflare D1 | 5GB free SQLite |
| Web viewer | Cloudflare Pages + hls.js | Free hosting, HLS playback |

## Conventions

### Rust (apps/desktop/src/)
- Use `thiserror` for error types, `anyhow` for propagation in commands
- Tauri commands return `Result<T, String>` (Tauri IPC constraint)
- Module structure: one `mod.rs` per directory, public API re-exports
- Use `tracing` for logging (not `println!` or `log`)
- Async with `tokio`, avoid blocking the main thread
- Apple framework calls via `objc2` crate family

### TypeScript (apps/desktop/ui/, apps/web/)
- Strict TypeScript — no `any`, no `as` casts unless justified
- React functional components only, hooks for logic
- Zustand for global state, React state for local UI state
- Tailwind CSS 4 for styling — no CSS modules, no styled-components
- Import Tauri APIs from `@tauri-apps/api`

### Cloudflare Workers (workers/)
- Hono framework for routing
- D1 for database, R2 for object storage
- All routes return JSON with consistent `{ data, error }` shape
- Auth via simple JWT (single user)

### General
- French comments are OK, but code identifiers in English
- No over-engineering — this is a personal tool
- Prefer simple solutions over abstractions
- Test critical paths (encoding, upload, transcription), skip trivial UI tests

## Key Commands

```bash
# Development
pnpm tauri:dev          # Run Tauri app in dev mode
pnpm worker:dev         # Run Cloudflare Worker locally
pnpm web:dev            # Run web viewer locally

# Build
pnpm tauri:build        # Build .dmg
pnpm worker:deploy      # Deploy to Cloudflare

# Check
cargo test              # Rust tests (in apps/desktop/)
cargo clippy            # Rust linting
pnpm typecheck          # TypeScript type checking
```

## Environment

- macOS Apple Silicon (16GB RAM)
- Rust 1.94+, Node.js 22+, pnpm 10+
- CMake 4+ (for building whisper.cpp)
- FFmpeg 8+ (for audio/video extraction)
- Ollama with qwen3.5:4b model
