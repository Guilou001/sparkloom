import { useRecordingStore } from "../stores/recordingStore";
import { Cloud, Check, Link, Loader2 } from "lucide-react";

export function UploadingView() {
  const uploadProgress = useRecordingStore((s) => s.uploadProgress);
  const shareUrl = useRecordingStore((s) => s.shareUrl);
  const error = useRecordingStore((s) => s.error);

  const phase = uploadProgress?.phase ?? "init";
  const uploaded = uploadProgress?.uploaded ?? 0;
  const total = uploadProgress?.total ?? 1;
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  const phaseLabels: Record<string, string> = {
    init: "Preparing...",
    segments: `Uploading segments (${uploaded}/${total})`,
    finalizing: "Finalizing...",
    done: "Upload complete!",
    error: "Upload failed",
  };

  const handleCopyLink = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Icon */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(99,102,241,0.15)" }}
      >
        {phase === "done" ? (
          <Check size={32} style={{ color: "#22c55e" }} />
        ) : (
          <Cloud size={32} style={{ color: "var(--color-primary)" }} />
        )}
      </div>

      {/* Phase label */}
      <div className="text-center">
        <h2 className="text-lg font-semibold">{phaseLabels[phase] ?? "Processing..."}</h2>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {phase !== "done" && (
        <div className="w-64">
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--color-surface-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                backgroundColor: "var(--color-primary)",
              }}
            />
          </div>
          <div
            className="mt-1 flex items-center justify-center gap-1 text-xs"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Loader2 size={12} className="animate-spin" />
            {pct}%
          </div>
        </div>
      )}

      {/* Share URL (shown as soon as backend creates the video) */}
      {shareUrl && (
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors hover:opacity-80"
          style={{
            backgroundColor: "var(--color-surface-elevated)",
            color: "var(--color-primary)",
          }}
        >
          <Link size={14} />
          Copy share link
        </button>
      )}
    </div>
  );
}
