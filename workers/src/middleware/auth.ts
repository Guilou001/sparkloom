import type { MiddlewareHandler } from "hono";
import type { Env } from "../index";

/**
 * Simple Bearer token auth for the desktop app.
 * The API_KEY is stored as a Wrangler secret.
 * Public routes (share links, manifests) skip this middleware.
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const apiKey = c.env.API_KEY;

  // In local dev, if no API_KEY is set, skip auth entirely
  if (!apiKey) {
    await next();
    return;
  }

  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  if (header.slice(7) !== apiKey) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  await next();
};
