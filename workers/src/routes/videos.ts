import { Hono } from "hono";
import type { Env } from "../index";
import type {
  CreateVideoRequest,
  CreateVideoResponse,
  UpdateVideoRequest,
  StopVideoRequest,
  Video,
} from "@sparkloom/shared";

const videos = new Hono<{ Bindings: Env }>();

// POST /api/videos — Create a new video record
videos.post("/", async (c) => {
  const body = await c.req.json<CreateVideoRequest>().catch(() => ({}) as CreateVideoRequest);

  const id = crypto.randomUUID();
  const shareToken = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await c.env.DB.prepare(
    `INSERT INTO videos (id, title, width, height, fps, codec, share_token)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.title ?? "Sans titre",
      body.width ?? null,
      body.height ?? null,
      body.fps ?? null,
      body.codec ?? "hevc",
      shareToken
    )
    .run();

  return c.json<CreateVideoResponse>({ id, share_token: shareToken }, 201);
});

// GET /api/videos — List all videos
videos.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const offset = Number(c.req.query("offset")) || 0;

  const countResult = await c.env.DB.prepare("SELECT COUNT(*) as total FROM videos").first<{ total: number }>();
  const result = await c.env.DB.prepare(
    "SELECT * FROM videos ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<Video>();

  return c.json({
    data: result.results,
    total: countResult?.total ?? 0,
    offset,
    limit,
  });
});

// GET /api/videos/:id — Get single video
videos.get("/:id", async (c) => {
  const video = await c.env.DB.prepare("SELECT * FROM videos WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Video>();

  if (!video) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json(video);
});

// PATCH /api/videos/:id — Update video metadata
videos.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UpdateVideoRequest>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) {
    sets.push("title = ?");
    values.push(body.title);
  }
  if (body.is_public !== undefined) {
    sets.push("is_public = ?");
    values.push(body.is_public ? 1 : 0);
  }

  if (sets.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  values.push(id);
  const result = await c.env.DB.prepare(
    `UPDATE videos SET ${sets.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json({ ok: true });
});

// POST /api/videos/:id/stop — Mark recording as stopped
videos.post("/:id/stop", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<StopVideoRequest>();

  const result = await c.env.DB.prepare(
    `UPDATE videos
     SET status = 'processing',
         duration_ms = ?,
         file_size_bytes = COALESCE(?, file_size_bytes),
         recording_stopped_at = datetime('now')
     WHERE id = ? AND status = 'recording'`
  )
    .bind(body.duration_ms, body.file_size_bytes ?? null, id)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Video not found or not recording" }, 404);
  }

  // Mark as ready (no server-side processing needed for now)
  await c.env.DB.prepare(
    `UPDATE videos SET status = 'ready', processing_completed_at = datetime('now') WHERE id = ?`
  )
    .bind(id)
    .run();

  return c.json({ ok: true });
});

// DELETE /api/videos/:id — Delete video + all R2 segments
videos.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Get all segment R2 keys
  const segments = await c.env.DB.prepare(
    "SELECT r2_key FROM video_segments WHERE video_id = ?"
  )
    .bind(id)
    .all<{ r2_key: string }>();

  // Delete R2 objects
  if (segments.results.length > 0) {
    await Promise.all(
      segments.results.map((s) => c.env.VIDEOS.delete(s.r2_key))
    );
  }

  // Also delete the init segment
  await c.env.VIDEOS.delete(`videos/${id}/init.mp4`).catch(() => {});

  // Delete from D1 (cascades to segments, transcriptions, summaries)
  const result = await c.env.DB.prepare("DELETE FROM videos WHERE id = ?")
    .bind(id)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json({ ok: true });
});

export { videos };
