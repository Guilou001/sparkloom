import { useEffect, useState } from "react";
import { VideoPlayer } from "../components/VideoPlayer";

interface VideoMeta {
  id: string;
  title: string;
  status: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  share_token: string;
  view_count: number;
  created_at: string;
}

// API base URL — in production, the Worker and Pages share the same domain
// or the Worker URL is configured. For now, fall back to localhost.
const API_BASE =
  import.meta.env.VITE_API_URL ??
  (window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : window.location.origin);

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function VideoPage({ shareToken }: { shareToken: string }) {
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/videos/share/${shareToken}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Video not found");
          if (res.status === 403) throw new Error("This video is private");
          throw new Error(`Error ${res.status}`);
        }
        return res.json();
      })
      .then((data: VideoMeta) => {
        setVideo(data);
        document.title = `${data.title} — SparkLoom`;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shareToken]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--color-primary)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">{error === "This video is private" ? "Private" : "Not Found"}</h1>
        <p style={{ color: "var(--color-text-secondary)" }}>
          {error ?? "This video doesn't exist."}
        </p>
      </div>
    );
  }

  const manifestUrl = `${API_BASE}/api/videos/${video.id}/manifest.m3u8`;
  const isLive = video.status === "recording";

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Video player */}
      <div
        className="relative w-full overflow-hidden rounded-xl"
        style={{
          aspectRatio: video.width && video.height ? `${video.width}/${video.height}` : "16/9",
          backgroundColor: "#000",
        }}
      >
        <VideoPlayer manifestUrl={manifestUrl} autoPlay={isLive} />

        {/* Live badge */}
        {isLive && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            LIVE
          </div>
        )}
      </div>

      {/* Video info */}
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">{video.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {video.duration_ms != null && (
            <span>{formatDuration(video.duration_ms)}</span>
          )}
          <span>{formatDate(video.created_at)}</span>
          <span>
            {video.view_count} view{video.view_count !== 1 ? "s" : ""}
          </span>
          {video.status === "processing" && (
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: "rgba(234,179,8,0.15)", color: "#eab308" }}
            >
              Processing...
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer
        className="mt-auto border-t pt-4 text-center text-xs"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
      >
        Recorded with{" "}
        <span className="font-medium" style={{ color: "var(--color-primary)" }}>
          SparkLoom
        </span>
      </footer>
    </div>
  );
}
