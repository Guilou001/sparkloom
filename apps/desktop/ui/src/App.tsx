import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Dashboard } from "./components/Dashboard";
import { RecordingControls } from "./components/RecordingControls";
import { UploadingView } from "./components/UploadingView";
import { CameraBubble } from "./components/CameraBubble";
import { useRecordingStore, type UploadProgress } from "./stores/recordingStore";

interface AppStatus {
  version: string;
  recording_available: boolean;
  ollama_available: boolean;
  ffmpeg_available: boolean;
}

interface StopResult {
  recording_id: string;
  output_path: string;
  duration_ms: number;
  video_frames: number;
  audio_buffers: number;
}

interface ShareReady {
  recording_id: string;
  video_id: string;
  share_token: string;
  share_url: string;
}

interface ProcessResult {
  video_id: string;
  share_token: string;
  share_url: string;
  segment_count: number;
  total_bytes: number;
}

// Detect which window we're in (main vs camera-bubble)
const windowLabel = getCurrentWindow().label;

function MainApp() {
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const status = useRecordingStore((s) => s.status);

  useEffect(() => {
    invoke<AppStatus>("get_app_status").then(setAppStatus);
  }, []);

  // Listen for recording completion (from camera bubble stop)
  useEffect(() => {
    const unlisten = listen<StopResult>("recording-complete", (event) => {
      const result = event.payload;
      const store = useRecordingStore.getState();

      // Transition to uploading state
      store.setStatus("uploading");
      store.setElapsed(0);
      store.setError(null);

      // Trigger segmentation + upload in background
      invoke<ProcessResult>("process_and_upload", {
        recordingId: result.recording_id,
        movPath: result.output_path,
        durationMs: result.duration_ms,
      })
        .then((processResult) => {
          store.addRecording({
            id: result.recording_id,
            title: "Sans titre",
            durationMs: result.duration_ms,
            createdAt: new Date().toISOString(),
            status: "ready",
            thumbnailUrl: null,
            shareUrl: processResult.share_url,
            outputPath: result.output_path,
          });
          store.setShareUrl(processResult.share_url);
          store.setUploadProgress(null);
          store.setStatus("idle");
          store.setCurrentRecordingId(null);
        })
        .catch((err) => {
          console.error("Processing/upload failed:", err);
          store.setError(String(err));
          // Still add recording locally (without cloud link)
          store.addRecording({
            id: result.recording_id,
            title: "Sans titre",
            durationMs: result.duration_ms,
            createdAt: new Date().toISOString(),
            status: "ready",
            thumbnailUrl: null,
            shareUrl: null,
            outputPath: result.output_path,
          });
          store.setUploadProgress(null);
          store.setStatus("idle");
          store.setCurrentRecordingId(null);
        });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for upload progress events
  useEffect(() => {
    const unlisten = listen<UploadProgress>("upload-progress", (event) => {
      useRecordingStore.getState().setUploadProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for share URL ready
  useEffect(() => {
    const unlisten = listen<ShareReady>("share-ready", (event) => {
      useRecordingStore.getState().setShareUrl(event.payload.share_url);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const renderContent = () => {
    if (status === "uploading") return <UploadingView />;
    if (status === "idle") return <Dashboard />;
    return <RecordingControls />;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Titlebar drag region */}
      <header
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: "var(--color-primary)" }}>
            SparkLoom
          </span>
          {appStatus && (
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              v{appStatus.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {appStatus && (
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: appStatus.ollama_available
                  ? "rgba(34,197,94,0.15)"
                  : "rgba(234,179,8,0.15)",
                color: appStatus.ollama_available ? "#22c55e" : "#eab308",
              }}
            >
              {appStatus.ollama_available ? "AI Ready" : "AI Offline"}
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">{renderContent()}</main>
    </div>
  );
}

function App() {
  if (windowLabel === "camera-bubble") {
    return <CameraBubble />;
  }
  return <MainApp />;
}

export default App;
