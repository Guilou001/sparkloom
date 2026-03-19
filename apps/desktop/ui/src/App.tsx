import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "motion/react";
import { Dashboard } from "./components/Dashboard";
import { RecordingControls } from "./components/RecordingControls";
import { CameraBubble } from "./components/CameraBubble";
import { PostRecordingPanel } from "./components/PostRecordingPanel";
import { ToastContainer } from "./components/Toast";
import { toast } from "./stores/toastStore";
import {
  useRecordingStore,
  type UploadProgress,
  type TranscriptionProgress,
  type SummaryProgress,
} from "./stores/recordingStore";

interface AppStatus {
  version: string;
  recording_available: boolean;
  ollama_available: boolean;
  ffmpeg_available: boolean;
  whisper_model_ready: boolean;
}

interface StopResult {
  recording_id: string;
  output_path: string;
  duration_ms: number;
  video_frames: number;
  audio_buffers: number;
  pause_intervals_ms: [number, number][];
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

interface TranscribeResult {
  full_text: string;
  language: string;
  word_count: number;
  segment_count: number;
  model_used: string;
}

interface SummaryGenerateResult {
  title: string;
  summary: string;
  key_points: string[];
  action_items: string[];
  topics: string[];
  sentiment: string;
  model_used: string;
}

interface ThumbnailResult {
  path: string;
  recording_id: string;
}

// Detect which window we're in (main vs camera-bubble)
const windowLabel = getCurrentWindow().label;

/** After transcription, try to generate an AI summary with Ollama. */
function startSummaryGeneration(
  videoId: string,
  transcript: string,
  ollamaAvailable: boolean
) {
  const store = useRecordingStore.getState();

  if (!ollamaAvailable || !transcript) {
    store.setStatus("idle");
    store.setCurrentRecordingId(null);
    store.setTranscriptionProgress(null);
    return;
  }

  store.setStatus("summarizing");
  store.setSummaryProgress(null);
  store.setSummaryResult(null);

  invoke<SummaryGenerateResult>("generate_summary", {
    videoId,
    transcript,
  })
    .then((result) => {
      store.setSummaryResult({
        title: result.title,
        summary: result.summary,
        key_points: result.key_points,
        action_items: result.action_items,
        topics: result.topics,
        sentiment: result.sentiment,
      });
      store.setSummaryProgress({ video_id: videoId, phase: "done", percent: 100 });
      toast.success("AI summary generated");
      setTimeout(() => {
        store.setStatus("idle");
        store.setCurrentRecordingId(null);
        store.setSummaryProgress(null);
      }, 2000);
    })
    .catch((err) => {
      console.error("Summary generation failed:", err);
      toast.error(`Summary failed: ${err}`, {
        label: "Retry",
        onClick: () => startSummaryGeneration(videoId, transcript, true),
      });
      setTimeout(() => {
        store.setStatus("idle");
        store.setCurrentRecordingId(null);
        store.setSummaryProgress(null);
      }, 1000);
    });
}

function MainApp() {
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const status = useRecordingStore((s) => s.status);

  useEffect(() => {
    invoke<AppStatus>("get_app_status").then((s) => {
      setAppStatus(s);
      useRecordingStore.getState().setWhisperModelReady(s.whisper_model_ready);
    });
  }, []);

  // Listen for recording completion (from camera bubble stop)
  useEffect(() => {
    const unlisten = listen<StopResult>("recording-complete", (event) => {
      const result = event.payload;
      const store = useRecordingStore.getState();

      // Go back to dashboard with post-recording panel visible
      store.setStatus("uploading");
      store.setElapsed(0);
      store.setError(null);
      toast.info("Recording saved");

      invoke<ProcessResult>("process_and_upload", {
        recordingId: result.recording_id,
        movPath: result.output_path,
        durationMs: result.duration_ms,
        pauseIntervalsMs: result.pause_intervals_ms.length > 0
          ? result.pause_intervals_ms
          : null,
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
          toast.success("Upload complete");

          // Generate thumbnail (fire-and-forget, don't block pipeline)
          invoke<ThumbnailResult>("generate_thumbnail", {
            recordingId: result.recording_id,
            movPath: result.output_path,
            durationMs: result.duration_ms,
          })
            .then((thumbResult) => {
              const assetUrl = convertFileSrc(thumbResult.path);
              // Update the recording in the store with the thumbnail
              const recs = useRecordingStore.getState().recordings.map((r) =>
                r.id === thumbResult.recording_id
                  ? { ...r, thumbnailUrl: assetUrl }
                  : r,
              );
              useRecordingStore.getState().setRecordings(recs);
            })
            .catch((err) => console.warn("Thumbnail generation failed:", err));

          // After upload, start transcription if model is ready
          if (store.whisperModelReady) {
            store.setStatus("transcribing");
            store.setTranscriptionProgress(null);

            invoke<TranscribeResult>("transcribe_recording", {
              videoId: processResult.video_id,
              movPath: result.output_path,
              language: null,
            })
              .then((transcribeResult) => {
                store.setTranscriptionText(transcribeResult.full_text);
                store.setTranscriptionProgress({
                  video_id: processResult.video_id,
                  phase: "done",
                  percent: 100,
                });
                toast.success("Transcription complete");
                startSummaryGeneration(
                  processResult.video_id,
                  transcribeResult.full_text,
                  appStatus?.ollama_available ?? false
                );
              })
              .catch((err) => {
                console.error("Transcription failed:", err);
                toast.error(`Transcription failed: ${err}`, {
                  label: "Retry",
                  onClick: () => {
                    store.setStatus("transcribing");
                    invoke<TranscribeResult>("transcribe_recording", {
                      videoId: processResult.video_id,
                      movPath: result.output_path,
                      language: null,
                    }).catch((e) => toast.error(`Retry failed: ${e}`));
                  },
                });
                setTimeout(() => {
                  store.setStatus("idle");
                  store.setCurrentRecordingId(null);
                  store.setTranscriptionProgress(null);
                }, 1000);
              });
          } else {
            store.setStatus("idle");
            store.setCurrentRecordingId(null);
          }
        })
        .catch((err) => {
          console.error("Processing/upload failed:", err);
          const offlineMsg = !navigator.onLine
            ? "Recording saved locally. Will retry when online."
            : `Upload failed: ${err}`;
          toast.error(offlineMsg, {
            label: "Retry",
            onClick: () => {
              const store = useRecordingStore.getState();
              store.setStatus("uploading");
              invoke<ProcessResult>("process_and_upload", {
                recordingId: result.recording_id,
                movPath: result.output_path,
                durationMs: result.duration_ms,
                pauseIntervalsMs: result.pause_intervals_ms.length > 0
                  ? result.pause_intervals_ms
                  : null,
              }).catch((e) => toast.error(`Retry failed: ${e}`));
            },
          });
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
  }, [appStatus]);

  // Listen for upload progress events
  useEffect(() => {
    const unlisten = listen<UploadProgress>("upload-progress", (event) => {
      useRecordingStore.getState().setUploadProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for share URL ready — auto-copy to clipboard + toast
  useEffect(() => {
    const unlisten = listen<ShareReady>("share-ready", (event) => {
      const url = event.payload.share_url;
      useRecordingStore.getState().setShareUrl(url);
      navigator.clipboard.writeText(url).then(() => {
        toast.success("Share link copied to clipboard");
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for transcription progress events
  useEffect(() => {
    const unlisten = listen<TranscriptionProgress>(
      "transcription-progress",
      (event) => {
        useRecordingStore
          .getState()
          .setTranscriptionProgress(event.payload);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for summary progress events
  useEffect(() => {
    const unlisten = listen<SummaryProgress>(
      "summary-progress",
      (event) => {
        useRecordingStore
          .getState()
          .setSummaryProgress(event.payload);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for whisper model download progress
  useEffect(() => {
    const unlisten = listen<{ downloaded: number; total: number; percent: number }>(
      "whisper-download-progress",
      (event) => {
        useRecordingStore
          .getState()
          .setWhisperDownloadPercent(event.payload.percent);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Offline detection — warn user when network is lost
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    const handleOffline = () => {
      wasOfflineRef.current = true;
      toast.error("You are offline. Recordings are saved locally and will upload when reconnected.");
    };
    const handleOnline = () => {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        toast.success("Back online");
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    // Check initial state
    if (!navigator.onLine) {
      handleOffline();
    }
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Dashboard stays visible during post-processing; recording views take full screen
  const isRecording = status === "countdown" || status === "recording" || status === "paused" || status === "processing";
  const isPostRecording = status === "uploading" || status === "transcribing" || status === "summarizing";

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
            <>
              <span
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: appStatus.whisper_model_ready
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(234,179,8,0.15)",
                  color: appStatus.whisper_model_ready ? "#22c55e" : "#eab308",
                }}
              >
                {appStatus.whisper_model_ready ? "Whisper Ready" : "No Whisper"}
              </span>
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
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.div
              key="recording"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <RecordingControls />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Dashboard />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isPostRecording && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
            >
              <PostRecordingPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Toast notifications */}
      <ToastContainer />
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
