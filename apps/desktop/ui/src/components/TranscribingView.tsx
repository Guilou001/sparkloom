import { useRecordingStore } from "../stores/recordingStore";
import { Loader2, FileText, Check } from "lucide-react";

const phaseLabels: Record<string, string> = {
  extracting_audio: "Extracting audio...",
  loading_model: "Loading Whisper model...",
  transcribing: "Transcribing with Whisper...",
  uploading: "Saving transcription...",
  done: "Transcription complete!",
};

export function TranscribingView() {
  const progress = useRecordingStore((s) => s.transcriptionProgress);
  const transcriptionText = useRecordingStore((s) => s.transcriptionText);
  const error = useRecordingStore((s) => s.error);
  const shareUrl = useRecordingStore((s) => s.shareUrl);

  const phase = progress?.phase ?? "extracting_audio";
  const percent = progress?.percent ?? 0;
  const isDone = phase === "done";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Icon */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(99,102,241,0.15)" }}
      >
        {isDone ? (
          <Check size={32} style={{ color: "#22c55e" }} />
        ) : (
          <FileText size={32} style={{ color: "var(--color-primary)" }} />
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
                backgroundColor: "var(--color-primary)",
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

      {/* Transcription preview */}
      {transcriptionText && (
        <div
          className="mx-4 max-h-32 w-full max-w-md overflow-y-auto rounded-lg p-3 text-sm"
          style={{
            backgroundColor: "var(--color-surface-elevated)",
            color: "var(--color-text-secondary)",
          }}
        >
          {transcriptionText.length > 300
            ? transcriptionText.slice(0, 300) + "..."
            : transcriptionText}
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
