import { useRecordingStore } from "../stores/recordingStore";
import { Loader2, Sparkles, Check } from "lucide-react";

const phaseLabels: Record<string, string> = {
  generating: "Generating AI summary...",
  uploading: "Saving summary...",
  done: "Summary complete!",
};

export function SummarizingView() {
  const progress = useRecordingStore((s) => s.summaryProgress);
  const summaryResult = useRecordingStore((s) => s.summaryResult);
  const error = useRecordingStore((s) => s.error);
  const shareUrl = useRecordingStore((s) => s.shareUrl);

  const phase = progress?.phase ?? "generating";
  const percent = progress?.percent ?? 0;
  const isDone = phase === "done";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Icon */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(168,85,247,0.15)" }}
      >
        {isDone ? (
          <Check size={32} style={{ color: "#22c55e" }} />
        ) : (
          <Sparkles size={32} style={{ color: "#a855f7" }} />
        )}
      </div>

      {/* Phase label */}
      <div className="text-center">
        <h2 className="text-lg font-semibold">
          {phaseLabels[phase] ?? "Processing..."}
        </h2>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {!isDone && (
        <div className="w-64">
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--color-surface-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${percent}%`,
                backgroundColor: "#a855f7",
              }}
            />
          </div>
          <div
            className="mt-1 flex items-center justify-center gap-1 text-xs"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Loader2 size={12} className="animate-spin" />
            {percent}%
          </div>
        </div>
      )}

      {/* Summary preview */}
      {summaryResult && (
        <div
          className="mx-4 w-full max-w-md space-y-3 rounded-lg p-4"
          style={{ backgroundColor: "var(--color-surface-elevated)" }}
        >
          {/* Title */}
          <h3 className="font-semibold" style={{ color: "var(--color-text)" }}>
            {summaryResult.title}
          </h3>

          {/* Summary text */}
          <p
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {summaryResult.summary}
          </p>

          {/* Key points */}
          {summaryResult.key_points.length > 0 && (
            <div>
              <p
                className="mb-1 text-xs font-medium uppercase"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Key Points
              </p>
              <ul className="space-y-1">
                {summaryResult.key_points.map((point, i) => (
                  <li
                    key={i}
                    className="text-sm"
                    style={{ color: "var(--color-text)" }}
                  >
                    &bull; {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Topics */}
          {summaryResult.topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summaryResult.topics.map((topic, i) => (
                <span
                  key={i}
                  className="rounded-full px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: "rgba(168,85,247,0.15)",
                    color: "#a855f7",
                  }}
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Share URL */}
      {shareUrl && isDone && (
        <button
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: "var(--color-surface-elevated)",
            color: "var(--color-primary)",
          }}
        >
          Copy share link
        </button>
      )}
    </div>
  );
}
