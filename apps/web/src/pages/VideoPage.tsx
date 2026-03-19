import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "../components/VideoPlayer";
import { TranscriptPanel, type TranscriptWord } from "../components/TranscriptPanel";
import { SummaryPanel } from "../components/SummaryPanel";
import { ChapterMarkers } from "../components/ChapterMarkers";

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

interface TranscriptionData {
  full_text: string | null;
  language: string;
  model_used: string;
  words: TranscriptWord[];
}

interface Chapter {
  start_ms: number;
  end_ms: number;
  title: string;
  summary: string;
}

interface SummaryData {
  title: string | null;
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  topics: string[] | null;
  sentiment: string | null;
  chapters: Chapter[] | null;
  model_used: string;
}

type Tab = "transcript" | "summary" | "chapters";

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

  const [transcription, setTranscription] = useState<TranscriptionData | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("transcript");

  const playerRef = useRef<VideoPlayerHandle>(null);

  // Fetch video metadata
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

  // Fetch transcription + summary once video is loaded
  useEffect(() => {
    if (!video) return;

    fetch(`${API_BASE}/api/videos/${video.id}/transcription`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TranscriptionData | null) => {
        if (data) setTranscription(data);
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/videos/${video.id}/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SummaryData | null) => {
        if (data) setSummary(data);
      })
      .catch(() => {});
  }, [video]);

  const handleSeek = useCallback((timeMs: number) => {
    playerRef.current?.seekTo(timeMs);
  }, []);

  const handleTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

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
  const hasTranscript = transcription && transcription.words.length > 0;
  const hasSummary = summary && summary.summary;
  const hasChapters = summary?.chapters && summary.chapters.length > 0;
  const hasSidePanel = hasTranscript || hasSummary || hasChapters;

  // Determine available tabs
  const tabs: { id: Tab; label: string }[] = [];
  if (hasTranscript) tabs.push({ id: "transcript", label: "Transcript" });
  if (hasSummary) tabs.push({ id: "summary", label: "Summary" });
  if (hasChapters) tabs.push({ id: "chapters", label: "Chapters" });

  // Auto-select first available tab if current isn't available
  const currentTab = tabs.find((t) => t.id === activeTab) ? activeTab : tabs[0]?.id ?? "transcript";

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Summary banner (above video) */}
      {hasSummary && summary && (
        <div
          className="rounded-xl px-5 py-4"
          style={{ backgroundColor: "var(--color-surface)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                {summary.summary}
              </p>
            </div>
            {summary.topics && summary.topics.length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {summary.topics.map((topic, i) => (
                  <span
                    key={i}
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: "rgba(99,102,241,0.15)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {topic}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content: video + side panel */}
      <div className={`flex gap-6 ${hasSidePanel ? "flex-col lg:flex-row" : "flex-col"}`}>
        {/* Left: Video player + info */}
        <div className={`flex flex-col gap-4 ${hasSidePanel ? "lg:flex-1" : "w-full"}`}>
          {/* Video player */}
          <div
            className="relative w-full overflow-hidden rounded-xl"
            style={{
              aspectRatio: video.width && video.height ? `${video.width}/${video.height}` : "16/9",
              backgroundColor: "#000",
            }}
          >
            <VideoPlayer
              ref={playerRef}
              manifestUrl={manifestUrl}
              autoPlay={isLive}
              onTimeUpdate={handleTimeUpdate}
            />

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
            <div
              className="flex flex-wrap items-center gap-3 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {video.duration_ms != null && <span>{formatDuration(video.duration_ms)}</span>}
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
        </div>

        {/* Right: Side panel with tabs */}
        {hasSidePanel && (
          <div
            className="flex flex-col overflow-hidden rounded-xl lg:w-96 lg:shrink-0"
            style={{
              backgroundColor: "var(--color-surface)",
              maxHeight: "calc(100vh - 200px)",
            }}
          >
            {/* Tabs */}
            {tabs.length > 1 && (
              <div
                className="flex shrink-0 border-b"
                style={{ borderColor: "var(--color-border)" }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 px-4 py-2.5 text-sm font-medium transition-colors"
                    style={{
                      color: currentTab === tab.id ? "var(--color-primary)" : "var(--color-text-secondary)",
                      borderBottom: currentTab === tab.id ? "2px solid var(--color-primary)" : "2px solid transparent",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {currentTab === "transcript" && hasTranscript && transcription && (
                <TranscriptPanel
                  words={transcription.words}
                  currentTimeMs={currentTimeMs}
                  onSeek={handleSeek}
                />
              )}
              {currentTab === "summary" && hasSummary && summary && (
                <SummaryPanel summary={summary} />
              )}
              {currentTab === "chapters" && hasChapters && summary?.chapters && (
                <ChapterMarkers
                  chapters={summary.chapters}
                  currentTimeMs={currentTimeMs}
                  durationMs={video.duration_ms ?? 0}
                  onSeek={handleSeek}
                />
              )}
            </div>
          </div>
        )}
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
