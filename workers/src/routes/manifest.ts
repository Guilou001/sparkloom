import { Hono } from "hono";
import type { Env } from "../index";

const manifest = new Hono<{ Bindings: Env }>();

// GET /api/videos/:id/manifest.m3u8 — Dynamic HLS manifest
manifest.get("/:id/manifest.m3u8", async (c) => {
  const videoId = c.req.param("id");

  // Get video metadata
  const video = await c.env.DB.prepare(
    "SELECT id, status, duration_ms, last_segment_index FROM videos WHERE id = ?"
  )
    .bind(videoId)
    .first<{ id: string; status: string; duration_ms: number | null; last_segment_index: number }>();

  if (!video) {
    return c.json({ error: "Video not found" }, 404);
  }

  // Get all segments
  const result = await c.env.DB.prepare(
    "SELECT segment_index, duration_ms FROM video_segments WHERE video_id = ? ORDER BY segment_index"
  )
    .bind(videoId)
    .all<{ segment_index: number; duration_ms: number | null }>();

  const segs = result.results;
  if (segs.length === 0) {
    return c.json({ error: "No segments available" }, 404);
  }

  // Default segment duration: 2 seconds
  const defaultDuration = 2.0;

  // Determine base URL for segments
  const baseUrl = new URL(c.req.url);
  const segmentBaseUrl = `${baseUrl.protocol}//${baseUrl.host}/api/videos/${videoId}/segments`;

  // Build HLS playlist
  const isLive = video.status === "recording";
  let playlist = "#EXTM3U\n";
  playlist += "#EXT-X-VERSION:7\n";
  playlist += `#EXT-X-TARGETDURATION:${Math.ceil(defaultDuration)}\n`;
  playlist += "#EXT-X-MEDIA-SEQUENCE:0\n";

  if (isLive) {
    // Live playlist — no ENDLIST tag, client will poll
    playlist += `#EXT-X-MAP:URI="${segmentBaseUrl}/init"\n`;

    // Show last 5 segments for live edge
    const liveSegs = segs.slice(-5);
    if (liveSegs.length > 0) {
      playlist += `#EXT-X-MEDIA-SEQUENCE:${liveSegs[0].segment_index}\n`;
    }
    for (const seg of liveSegs) {
      const dur = seg.duration_ms ? seg.duration_ms / 1000 : defaultDuration;
      playlist += `#EXTINF:${dur.toFixed(3)},\n`;
      playlist += `${segmentBaseUrl}/${String(seg.segment_index).padStart(5, "0")}\n`;
    }
  } else {
    // VOD playlist — complete with ENDLIST
    playlist += "#EXT-X-PLAYLIST-TYPE:VOD\n";
    playlist += `#EXT-X-MAP:URI="${segmentBaseUrl}/init"\n`;

    for (const seg of segs) {
      const dur = seg.duration_ms ? seg.duration_ms / 1000 : defaultDuration;
      playlist += `#EXTINF:${dur.toFixed(3)},\n`;
      playlist += `${segmentBaseUrl}/${String(seg.segment_index).padStart(5, "0")}\n`;
    }

    playlist += "#EXT-X-ENDLIST\n";
  }

  return new Response(playlist, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": isLive ? "no-cache" : "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

// GET /api/videos/share/:token — Public video info by share token
manifest.get("/share/:token", async (c) => {
  const token = c.req.param("token");

  const video = await c.env.DB.prepare(
    `SELECT id, title, status, duration_ms, width, height, share_token,
            view_count, created_at, is_public
     FROM videos WHERE share_token = ?`
  )
    .bind(token)
    .first();

  if (!video) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (!video.is_public) {
    return c.json({ error: "Video is private" }, 403);
  }

  // Increment view count
  await c.env.DB.prepare("UPDATE videos SET view_count = view_count + 1 WHERE share_token = ?")
    .bind(token)
    .run();

  return c.json(video);
});

export { manifest };
