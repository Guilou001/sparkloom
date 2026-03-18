import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Video, Plus, Clock, Eye, Link2, Trash2 } from "lucide-react";
import { useRecordingStore, type Recording } from "../stores/recordingStore";

function formatDuration(ms: number | null): string {
  if (!ms) return "--:--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RecordingCard({ recording }: { recording: Recording }) {
  return (
    <div
      className="group flex flex-col overflow-hidden rounded-xl border transition-colors hover:border-indigo-500/50"
      style={{
        backgroundColor: "var(--color-surface-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Thumbnail */}
      <div
        className="relative flex aspect-video items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {recording.thumbnailUrl ? (
          <img
            src={recording.thumbnailUrl}
            alt={recording.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <Video size={32} style={{ color: "var(--color-text-secondary)" }} />
        )}
        <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
          {formatDuration(recording.durationMs)}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-medium">{recording.title}</h3>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatDate(recording.createdAt)}
          </span>
        </div>

        {/* Actions (visible on hover) */}
        <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {recording.shareUrl && (
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
              title="Copy link"
            >
              <Link2 size={12} />
              Share
            </button>
          )}
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Eye size={12} />
          </button>
          <button
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-red-500/20 hover:text-red-400"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const recordings = useRecordingStore((s) => s.recordings);
  const setRecordings = useRecordingStore((s) => s.setRecordings);
  const setStatus = useRecordingStore((s) => s.setStatus);

  useEffect(() => {
    invoke<Recording[]>("get_recordings").then((data) => {
      setRecordings(
        data.map((r) => ({
          id: r.id,
          title: r.title,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
          status: r.status,
          thumbnailUrl: r.thumbnailUrl,
          shareUrl: r.shareUrl,
        })),
      );
    });

    // Listen for tray "New Recording" click
    const unlisten = listen("start-recording", () => {
      setStatus("countdown");
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setRecordings, setStatus]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recordings</h1>
        <button
          onClick={() => setStatus("countdown")}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
          style={{
            backgroundColor: "var(--color-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--color-primary-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--color-primary)")
          }
        >
          <Plus size={18} />
          New Recording
        </button>
      </div>

      {/* Recording grid */}
      {recordings.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {recordings.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "var(--color-surface-elevated)" }}
          >
            <Video size={28} style={{ color: "var(--color-text-secondary)" }} />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-medium">No recordings yet</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              Click "New Recording" to get started
            </p>
          </div>
          <button
            onClick={() => setStatus("countdown")}
            className="mt-2 flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--color-primary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--color-primary-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--color-primary)")
            }
          >
            <Video size={18} />
            Start Recording
          </button>
        </div>
      )}
    </div>
  );
}
