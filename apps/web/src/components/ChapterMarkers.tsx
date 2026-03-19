interface Chapter {
  start_ms: number;
  end_ms: number;
  title: string;
  summary: string;
}

interface ChapterMarkersProps {
  chapters: Chapter[];
  currentTimeMs: number;
  durationMs: number;
  onSeek: (timeMs: number) => void;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ChapterMarkers({ chapters, currentTimeMs, durationMs, onSeek }: ChapterMarkersProps) {
  if (chapters.length === 0) return null;

  // Find active chapter
  const activeIdx = chapters.findIndex(
    (ch) => currentTimeMs >= ch.start_ms && currentTimeMs < ch.end_ms
  );

  return (
    <div className="space-y-1 overflow-y-auto px-3 py-3">
      {/* Visual timeline bar */}
      {durationMs > 0 && (
        <div
          className="mb-4 flex h-2 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--color-surface)" }}
        >
          {chapters.map((ch, i) => {
            const widthPct = ((ch.end_ms - ch.start_ms) / durationMs) * 100;
            const isActive = i === activeIdx;
            return (
              <button
                key={i}
                onClick={() => onSeek(ch.start_ms)}
                className="h-full transition-opacity hover:opacity-80"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: isActive ? "var(--color-primary)" : "var(--color-border)",
                  borderRight: i < chapters.length - 1 ? "1px solid var(--color-bg)" : undefined,
                }}
                title={ch.title}
              />
            );
          })}
        </div>
      )}

      {/* Chapter list */}
      {chapters.map((ch, i) => {
        const isActive = i === activeIdx;
        return (
          <button
            key={i}
            onClick={() => onSeek(ch.start_ms)}
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
            style={{
              backgroundColor: isActive ? "rgba(99,102,241,0.1)" : undefined,
            }}
          >
            {/* Chapter number */}
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
              style={{
                backgroundColor: isActive ? "var(--color-primary)" : "var(--color-surface-elevated)",
                color: isActive ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-medium"
                  style={{ color: isActive ? "var(--color-primary)" : "var(--color-text)" }}
                >
                  {ch.title}
                </span>
                <span
                  className="shrink-0 text-xs font-mono"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {formatTimestamp(ch.start_ms)}
                </span>
              </div>
              {ch.summary && (
                <p
                  className="mt-0.5 text-xs leading-relaxed"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {ch.summary}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
