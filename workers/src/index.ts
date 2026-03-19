import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { videos } from "./routes/videos";
import { segments } from "./routes/segments";
import { manifest } from "./routes/manifest";
import { transcription, transcriptionPublic } from "./routes/transcription";

export type Env = {
  DB: D1Database;
  VIDEOS: R2Bucket;
  API_KEY: string;
  CORS_ORIGIN: string;
};

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/", (c) => c.json({ name: "SparkLoom API", version: "0.1.0" }));
app.get("/health", (c) => c.json({ ok: true }));

// Public routes (no auth required)
app.route("/api/videos", manifest); // manifest.m3u8, share/:token
app.route("/api/videos", segments); // GET segments (for HLS playback)
app.route("/api/videos", transcriptionPublic); // GET transcription + summary (read-only)

// Authenticated routes
app.use("/api/*", authMiddleware);
app.route("/api/videos", videos); // CRUD
app.route("/api/videos", segments); // PUT segments (upload)
app.route("/api/videos", transcription); // transcription + summary

export default app;
