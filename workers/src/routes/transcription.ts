import { Hono } from "hono";
import type { Env } from "../index";
import type { SaveTranscriptionRequest, SaveSummaryRequest } from "@sparkloom/shared";

const transcription = new Hono<{ Bindings: Env }>();

// POST /api/videos/:id/transcription — Save transcription from desktop app
transcription.post("/:id/transcription", async (c) => {
  const videoId = c.req.param("id");
  const body = await c.req.json<SaveTranscriptionRequest>();

  const id = crypto.randomUUID();

  // Save transcription
  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO transcriptions (id, video_id, full_text, language, model_used, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, videoId, body.full_text, body.language, body.model_used, body.confidence ?? null)
    .run();

  // Save individual words with timestamps
  if (body.words.length > 0) {
    // Delete existing words first
    await c.env.DB.prepare("DELETE FROM transcript_words WHERE video_id = ?").bind(videoId).run();

    // Batch insert (D1 supports up to 100 bindings per statement)
    const batchSize = 20;
    for (let i = 0; i < body.words.length; i += batchSize) {
      const batch = body.words.slice(i, i + batchSize);
      const stmts = batch.map((w) =>
        c.env.DB.prepare(
          "INSERT INTO transcript_words (video_id, word, start_ms, end_ms, confidence) VALUES (?, ?, ?, ?, ?)"
        ).bind(videoId, w.word, w.start_ms, w.end_ms, w.confidence ?? null)
      );
      await c.env.DB.batch(stmts);
    }
  }

  return c.json({ id }, 201);
});

// GET /api/videos/:id/transcription — Get transcription + words
transcription.get("/:id/transcription", async (c) => {
  const videoId = c.req.param("id");

  const trans = await c.env.DB.prepare("SELECT * FROM transcriptions WHERE video_id = ?")
    .bind(videoId)
    .first();

  if (!trans) {
    return c.json({ error: "Transcription not found" }, 404);
  }

  const words = await c.env.DB.prepare(
    "SELECT word, start_ms, end_ms, confidence FROM transcript_words WHERE video_id = ? ORDER BY start_ms"
  )
    .bind(videoId)
    .all();

  return c.json({ ...trans, words: words.results });
});

// POST /api/videos/:id/summary — Save AI summary
transcription.post("/:id/summary", async (c) => {
  const videoId = c.req.param("id");
  const body = await c.req.json<SaveSummaryRequest>();

  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO video_summaries
     (id, video_id, title, summary, key_points, action_items, chapters, sentiment, topics, model_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      videoId,
      body.title ?? null,
      body.summary,
      body.key_points ? JSON.stringify(body.key_points) : null,
      body.action_items ? JSON.stringify(body.action_items) : null,
      body.chapters ? JSON.stringify(body.chapters) : null,
      body.sentiment ?? null,
      body.topics ? JSON.stringify(body.topics) : null,
      body.model_used
    )
    .run();

  // Update video title if provided
  if (body.title) {
    await c.env.DB.prepare("UPDATE videos SET title = ? WHERE id = ?")
      .bind(body.title, videoId)
      .run();
  }

  return c.json({ id }, 201);
});

// GET /api/videos/:id/summary — Get summary
transcription.get("/:id/summary", async (c) => {
  const videoId = c.req.param("id");

  const summary = await c.env.DB.prepare("SELECT * FROM video_summaries WHERE video_id = ?")
    .bind(videoId)
    .first();

  if (!summary) {
    return c.json({ error: "Summary not found" }, 404);
  }

  // Parse JSON fields
  return c.json({
    ...summary,
    key_points: summary.key_points ? JSON.parse(summary.key_points as string) : null,
    action_items: summary.action_items ? JSON.parse(summary.action_items as string) : null,
    chapters: summary.chapters ? JSON.parse(summary.chapters as string) : null,
    topics: summary.topics ? JSON.parse(summary.topics as string) : null,
  });
});

export { transcription };
