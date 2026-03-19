import { useState, useEffect } from "react";
import { Cloud, FileText, Sparkles, Check, Link, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { useRecordingStore } from "../stores/recordingStore";
import { toast } from "../stores/toastStore";

function ProgressRow({
  icon,
  label,
  percent,
  done,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number;
  done: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="shrink-0">{done ? <Check size={16} style={{ color: "#22c55e" }} /> : icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: done ? "#22c55e" : "var(--color-text)" }}>{label}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>{done ? "Done" : `${percent}%`}</span>
        </div>
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--color-surface)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${done ? 100 : percent}%`,
              backgroundColor: done ? "#22c55e" : color,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function PostRecordingPanel() {
  const status = useRecordingStore((s) => s.status);
  const uploadProgress = useRecordingStore((s) => s.uploadProgress);
  const transcriptionProgress = useRecordingStore((s) => s.transcriptionProgress);
  const summaryProgress = useRecordingStore((s) => s.summaryProgress);
  const shareUrl = useRecordingStore((s) => s.shareUrl);

  const [minimized, setMinimized] = useState(false);

  // Auto-minimize 5s after all pipelines are done
  useEffect(() => {
    if (status === "idle") return;
    const allDone =
      uploadProgress?.phase === "done" &&
      transcriptionProgress?.phase === "done" &&
      summaryProgress?.phase === "done";
    if (!allDone) return;

    const timer = setTimeout(() => setMinimized(true), 5000);
    return () => clearTimeout(timer);
  }, [status, uploadProgress, transcriptionProgress, summaryProgress]);

  // Upload progress
  const uploadPct =
    uploadProgress && uploadProgress.total > 0
      ? Math.round((uploadProgress.uploaded / uploadProgress.total) * 100)
      : 0;
  const uploadDone = status !== "uploading" || uploadProgress?.phase === "done";

  // Transcription progress
  const transPct = transcriptionProgress?.percent ?? 0;
  const transDone = transcriptionProgress?.phase === "done";
  const transActive = status === "transcribing" || transDone;

  // Summary progress
  const summPct = summaryProgress?.percent ?? 0;
  const summDone = summaryProgress?.phase === "done";
  const summActive = status === "summarizing" || summDone;

  const handleCopyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        toast.success("Link copied");
      });
    }
  };

  const handleOpenInBrowser = () => {
    if (shareUrl) {
      window.open(shareUrl, "_blank");
    }
  };

  // Minimized badge
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 shadow-lg transition-colors hover:border-indigo-500/50"
        style={{
          backgroundColor: "var(--color-surface-elevated)",
          borderColor: "var(--color-border)",
        }}
      >
        <Check size={14} style={{ color: "#22c55e" }} />
        <span className="text-xs font-medium">Processing complete</span>
        <ChevronUp size={14} style={{ color: "var(--color-text-secondary)" }} />
      </button>
    );
  }

  return (
    <div
      className="absolute inset-x-4 bottom-4 rounded-xl border p-4 shadow-xl"
      style={{
        backgroundColor: "var(--color-surface-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Processing</span>
        <button
          onClick={() => setMinimized(true)}
          className="rounded p-1 transition-colors hover:bg-white/10"
        >
          <ChevronDown size={14} style={{ color: "var(--color-text-secondary)" }} />
        </button>
      </div>

      {/* Progress rows */}
      <div className="space-y-3">
        <ProgressRow
          icon={<Cloud size={16} style={{ color: "var(--color-primary)" }} />}
          label="Upload"
          percent={uploadPct}
          done={uploadDone}
          color="var(--color-primary)"
        />
        {transActive && (
          <ProgressRow
            icon={<FileText size={16} style={{ color: "var(--color-primary)" }} />}
            label="Transcription"
            percent={transPct}
            done={transDone}
            color="var(--color-primary)"
          />
        )}
        {summActive && (
          <ProgressRow
            icon={<Sparkles size={16} style={{ color: "#a855f7" }} />}
            label="AI Summary"
            percent={summPct}
            done={summDone}
            color="#a855f7"
          />
        )}
      </div>

      {/* Action buttons */}
      {shareUrl && (
        <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          <button
            onClick={handleCopyLink}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: "rgba(99,102,241,0.15)", color: "var(--color-primary)" }}
          >
            <Link size={12} />
            Copy Link
          </button>
          <button
            onClick={handleOpenInBrowser}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text-secondary)" }}
          >
            <ExternalLink size={12} />
            Open in Browser
          </button>
        </div>
      )}
    </div>
  );
}
