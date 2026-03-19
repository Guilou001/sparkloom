import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "motion/react";
import { Video, Plus, Clock, Eye, Link2, Trash2, Download, Loader2, Pencil, Search, ChevronDown, Upload, FileDown } from "lucide-react";
import { useRecordingStore, type Recording } from "../stores/recordingStore";
import { toast } from "../stores/toastStore";

type SortOption = "newest" | "oldest" | "longest" | "shortest";

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

function RecordingCard({ recording, index }: { recording: Recording; index: number }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(recording.title);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useRecordingStore.getState;

  const handleCopyLink = useCallback(() => {
    if (recording.shareUrl) {
      navigator.clipboard.writeText(recording.shareUrl).then(() => {
        toast.success("Link copied");
      });
    }
  }, [recording.shareUrl]);

  const handleOpenInBrowser = useCallback(() => {
    if (recording.shareUrl) {
      window.open(recording.shareUrl, "_blank");
    }
  }, [recording.shareUrl]);

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await invoke("delete_recording", { videoId: recording.id });
      const recs = store().recordings.filter((r) => r.id !== recording.id);
      store().setRecordings(recs);
      toast.success("Recording deleted");
    } catch (err) {
      toast.error(`Delete failed: ${err}`);
      setDeleting(false);
    }
  }, [recording.id, deleting, store]);

  const handleRenameStart = useCallback(() => {
    setEditTitle(recording.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [recording.title]);

  const handleExport = useCallback(async () => {
    if (!recording.outputPath) {
      toast.error("No local file available for export");
      return;
    }
    try {
      await invoke("export_recording", {
        movPath: recording.outputPath,
        title: recording.title,
      });
      toast.success("Recording exported");
    } catch (err) {
      if (String(err).includes("cancelled")) return;
      toast.error(`Export failed: ${err}`);
    }
  }, [recording.outputPath, recording.title]);

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = editTitle.trim();
    if (!trimmed || trimmed === recording.title) {
      setEditing(false);
      return;
    }
    try {
      await invoke("rename_recording", { videoId: recording.id, title: trimmed });
      const recs = store().recordings.map((r) =>
        r.id === recording.id ? { ...r, title: trimmed } : r,
      );
      store().setRecordings(recs);
      toast.success("Renamed");
    } catch (err) {
      toast.error(`Rename failed: ${err}`);
    }
    setEditing(false);
  }, [editTitle, recording.id, recording.title, store]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      className="group flex flex-col overflow-hidden rounded-xl border transition-colors hover:border-indigo-500/50"
      style={{
        backgroundColor: "var(--color-surface-elevated)",
        borderColor: "var(--color-border)",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {/* Thumbnail */}
      <div
        className="relative flex aspect-video items-center justify-center"
        style={{ backgroundColor: "var(--color-surface)" }}
        onClick={handleOpenInBrowser}
      >
        {recording.thumbnailUrl ? (
          <img
            src={recording.thumbnailUrl}
            alt={recording.title}
            className="h-full w-full cursor-pointer object-cover"
            loading="lazy"
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
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="truncate rounded border bg-transparent px-1 text-sm font-medium outline-none focus:border-indigo-500"
            style={{ borderColor: "var(--color-border)" }}
          />
        ) : (
          <h3
            className="cursor-text truncate text-sm font-medium"
            onDoubleClick={handleRenameStart}
            title="Double-click to rename"
          >
            {recording.title}
          </h3>
        )}
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
              onClick={handleCopyLink}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
              title="Copy link"
            >
              <Link2 size={12} />
              Share
            </button>
          )}
          <button
            onClick={handleOpenInBrowser}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-secondary)" }}
            title="Open in browser"
          >
            <Eye size={12} />
          </button>
          <button
            onClick={handleRenameStart}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-secondary)" }}
            title="Rename"
          >
            <Pencil size={12} />
          </button>
          {recording.outputPath && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
              style={{ color: "var(--color-text-secondary)" }}
              title="Export MP4"
            >
              <FileDown size={12} />
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-red-500/20 hover:text-red-400"
            style={{ color: "var(--color-text-secondary)" }}
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function WhisperModelBanner() {
  const whisperReady = useRecordingStore((s) => s.whisperModelReady);
  const downloadPercent = useRecordingStore((s) => s.whisperDownloadPercent);
  const [downloading, setDownloading] = useState(false);

  if (whisperReady) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await invoke("download_whisper_model");
      useRecordingStore.getState().setWhisperModelReady(true);
      useRecordingStore.getState().setWhisperDownloadPercent(null);
    } catch (err) {
      console.error("Model download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 rounded-lg border p-3"
      style={{
        borderColor: "rgba(234,179,8,0.3)",
        backgroundColor: "rgba(234,179,8,0.05)",
      }}
    >
      <Download size={18} style={{ color: "#eab308" }} />
      <div className="flex-1">
        <p className="text-sm font-medium">Whisper model not installed</p>
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          Download the model (~1.5 GB) to enable automatic transcription
        </p>
        {downloading && downloadPercent != null && (
          <div className="mt-1.5">
            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${downloadPercent}%`,
                  backgroundColor: "#eab308",
                }}
              />
            </div>
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {downloadPercent}%
            </span>
          </div>
        )}
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: "rgba(234,179,8,0.15)", color: "#eab308" }}
      >
        {downloading ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Downloading...
          </>
        ) : (
          <>
            <Download size={12} />
            Download
          </>
        )}
      </button>
    </div>
  );
}

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest",
  oldest: "Oldest",
  longest: "Longest",
  shortest: "Shortest",
};

function SortDropdown({
  value,
  onChange,
}: {
  value: SortOption;
  onChange: (v: SortOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors hover:border-indigo-500/50"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface-elevated)",
        }}
      >
        {SORT_LABELS[value]}
        <ChevronDown size={14} style={{ color: "var(--color-text-secondary)" }} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-10 mt-1 min-w-[130px] overflow-hidden rounded-lg border shadow-lg"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface-elevated)",
          }}
        >
          {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-2 text-xs transition-colors hover:bg-white/10"
              style={{
                fontWeight: opt === value ? 600 : 400,
                color: opt === value ? "var(--color-primary)" : undefined,
              }}
            >
              {SORT_LABELS[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ImportResult {
  recording_id: string;
  output_path: string;
  duration_ms: number;
}

export function Dashboard() {
  const recordings = useRecordingStore((s) => s.recordings);
  const setRecordings = useRecordingStore((s) => s.setRecordings);
  const setStatus = useRecordingStore((s) => s.setStatus);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [dragging, setDragging] = useState(false);

  const handleImportFile = useCallback(async (filePath: string) => {
    const fileName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Imported video";
    try {
      const result = await invoke<ImportResult>("import_video", { filePath });
      useRecordingStore.getState().addRecording({
        id: result.recording_id,
        title: fileName,
        durationMs: result.duration_ms,
        createdAt: new Date().toISOString(),
        status: "ready",
        thumbnailUrl: null,
        shareUrl: null,
        outputPath: result.output_path,
      });
      toast.success(`Imported "${fileName}"`);
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  }, []);

  const handleImportClick = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mov", "mp4", "mkv", "avi", "webm"] }],
    });
    if (selected) {
      handleImportFile(selected);
    }
  }, [handleImportFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const video = files.find((f) =>
        /\.(mov|mp4|mkv|avi|webm)$/i.test(f.name),
      );
      if (video) {
        // Tauri provides the full path via webkitRelativePath or name
        // For drag & drop in Tauri, we use the file path from dataTransfer
        const path = (video as File & { path?: string }).path;
        if (path) {
          handleImportFile(path);
        } else {
          toast.error("Cannot read file path. Try using the Import button instead.");
        }
      }
    },
    [handleImportFile],
  );

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

  const filtered = useMemo(() => {
    let list = recordings;

    // Filter by search query (case-insensitive title match)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q));
    }

    // Sort
    const sorted = [...list];
    switch (sortBy) {
      case "newest":
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "oldest":
        sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "longest":
        sorted.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
        break;
      case "shortest":
        sorted.sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
        break;
    }

    return sorted;
  }, [recordings, searchQuery, sortBy]);

  return (
    <div
      className="flex flex-col gap-6"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-400 px-12 py-10">
            <Upload size={40} className="text-indigo-400" />
            <p className="text-lg font-medium text-indigo-300">Drop video to import</p>
            <p className="text-xs text-indigo-400/70">.mov, .mp4, .mkv, .avi, .webm</p>
          </div>
        </div>
      )}

      {/* Whisper model download banner */}
      <WhisperModelBanner />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recordings</h1>
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleImportClick}
            className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover:border-indigo-500/50"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Upload size={16} />
            Import
          </motion.button>
        <motion.button
          whileTap={{ scale: 0.95 }}
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
        </motion.button>
        </div>
      </div>

      {/* Search & Sort bar (only show when there are recordings) */}
      {recordings.length > 0 && (
        <div className="flex items-center gap-3">
          <div
            className="flex flex-1 items-center gap-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-surface-elevated)",
            }}
          >
            <Search size={14} style={{ color: "var(--color-text-secondary)" }} />
            <input
              type="text"
              placeholder="Search recordings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--color-text-secondary)]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs transition-colors hover:text-white"
                style={{ color: "var(--color-text-secondary)" }}
              >
                &times;
              </button>
            )}
          </div>
          <SortDropdown value={sortBy} onChange={setSortBy} />
        </div>
      )}

      {/* Recording grid */}
      {recordings.length > 0 ? (
        filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <AnimatePresence>
              {filtered.map((recording, i) => (
                <RecordingCard key={recording.id} recording={recording} index={i} />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Search size={24} style={{ color: "var(--color-text-secondary)" }} />
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              No recordings match "{searchQuery}"
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="text-xs text-indigo-400 transition-colors hover:text-indigo-300"
            >
              Clear search
            </button>
          </div>
        )
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
