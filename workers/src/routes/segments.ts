import { Hono } from "hono";
import type { Env } from "../index";
import type { UploadSegmentResponse } from "@sparkloom/shared";

const segments = new Hono<{ Bindings: Env }>();

// PUT /api/videos/:id/segments/:idx — Upload a video segment to R2
segments.put("/:id/segments/:idx", async (c) => {
  const videoId = c.req.param("id");
  const segmentIndex = Number(c.req.param("idx"));

  // -1 = init segment, 0+ = media segments
  if (isNaN(segmentIndex) || segmentIndex < -1) {
    return c.json({ error: "Invalid segment index" }, 400);
  }

  // Verify video exists
  const video = await c.env.DB.prepare("SELECT id, status FROM videos WHERE id = ?")
    .bind(videoId)
    .first<{ id: string; status: string }>();

  if (!video) {
    return c.json({ error: "Video not found" }, 404);
  }

  // Read the raw body (binary segment data)
  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    return c.json({ error: "Empty segment body" }, 400);
  }

  // Determine the R2 key
  const isInit = segmentIndex === -1;
  const r2Key = isInit
    ? `videos/${videoId}/init.mp4`
    : `videos/${videoId}/seg_${String(segmentIndex).padStart(5, "0")}.m4s`;

  // Upload to R2
  await c.env.VIDEOS.put(r2Key, body, {
    httpMetadata: {
      contentType: isInit ? "video/mp4" : "video/iso.segment",
    },
  });

  // Record in D1 (skip for init segment)
  if (!isInit) {
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO video_segments (video_id, segment_index, r2_key, size_bytes)
       VALUES (?, ?, ?, ?)`
    )
      .bind(videoId, segmentIndex, r2Key, body.byteLength)
      .run();

    // Update last_segment_index
    await c.env.DB.prepare(
      `UPDATE videos SET last_segment_index = MAX(last_segment_index, ?),
              file_size_bytes = file_size_bytes + ?
       WHERE id = ?`
    )
      .bind(segmentIndex, body.byteLength, videoId)
      .run();
  }

  return c.json<UploadSegmentResponse>({ r2_key: r2Key, segment_index: segmentIndex });
});

// GET /api/videos/:id/segments/:idx — Stream segment from R2
segments.get("/:id/segments/:idx", async (c) => {
  const videoId = c.req.param("id");
  const idx = c.req.param("idx");

  const r2Key =
    idx === "init"
      ? `videos/${videoId}/init.mp4`
      : `videos/${videoId}/seg_${idx.padStart(5, "0")}.m4s`;

  const object = await c.env.VIDEOS.get(r2Key);
  if (!object) {
    return c.json({ error: "Segment not found" }, 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});

export { segments };
