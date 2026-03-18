# SparkLoom

A free ($0/month) Loom clone for personal use on macOS Apple Silicon. Record your screen, webcam, and audio, then share instantly via a link.

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri v2 (Rust + React 19) |
| Frontend | Vite 6 + TypeScript + Tailwind CSS 4 |
| State | Zustand 5 |
| Screen Capture | ScreenCaptureKit (via screencapturekit-rs) |
| HW Encoding | HEVC via VideoToolbox |
| API | Cloudflare Workers + Hono |
| Video Storage | Cloudflare R2 (10GB free) |
| Database | Cloudflare D1 (SQLite) |
| Web Viewer | Cloudflare Pages + hls.js |
| Transcription | whisper-cpp-plus-rs (Metal GPU) |
| AI Summaries | Ollama + Qwen 3.5 4B (local) |

## Features

- Screen + webcam + system audio + microphone recording
- Hardware-accelerated HEVC encoding (Apple Silicon)
- Floating webcam bubble during recording
- fMP4 segmentation + parallel upload to Cloudflare R2
- Instant share link generation
- HLS streaming playback in browser
- On-device AI transcription (Whisper)
- Local AI summaries (Ollama)
- System tray integration
- Zero cost: everything runs on free tiers

## Prerequisites

- macOS 14+ (Apple Silicon)
- Rust 1.94+
- Node.js 22+
- pnpm 10+
- FFmpeg 8+
- Ollama (optional, for AI summaries)

## Getting Started

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri:dev

# Run Cloudflare Worker locally
pnpm worker:dev
```

## Project Structure

```
sparkloom/
├── apps/desktop/          # Tauri v2 desktop app
│   ├── src/               # Rust backend (capture, encoding, upload)
│   ├── ui/                # React frontend
│   └── tauri.conf.json
├── apps/web/              # Web viewer (Cloudflare Pages)
├── packages/shared/       # Shared TypeScript types
├── workers/               # Cloudflare Workers API (Hono)
└── scripts/               # Setup scripts
```

## License

MIT
