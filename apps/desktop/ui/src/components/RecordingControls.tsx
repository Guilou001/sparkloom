import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Square, Pause, Play, Monitor, AlertCircle } from "lucide-react";
import {
  useRecordingStore,
  type StartResult,
  type StopResult,
} from "../stores/recordingStore";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function CountdownOverlay({ onComplete }: { onComplete: () => void }) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div
          className="mb-4 text-8xl font-bold tabular-nums"
          style={{ color: "var(--color-primary)" }}
        >
          {count}
        </div>
        <p style={{ color: "var(--color-text-secondary)" }}>Recording starts in...</p>
      </div>
    </div>
  );
}

export function RecordingControls() {
  const status = useRecordingStore((s) => s.status);
  const elapsed = useRecordingStore((s) => s.elapsed);
  const error = useRecordingStore((s) => s.error);
  const setStatus = useRecordingStore((s) => s.setStatus);
  const setElapsed = useRecordingStore((s) => s.setElapsed);
  const setCurrentRecordingId = useRecordingStore((s) => s.setCurrentRecordingId);
  const setError = useRecordingStore((s) => s.setError);
  const addRecording = useRecordingStore((s) => s.addRecording);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(useRecordingStore.getState().elapsed + 1);
    }, 1000);
  }, [setElapsed]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleCountdownComplete = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke<StartResult>("start_recording", {
        displayId: null,
      });
      setCurrentRecordingId(result.recording_id);
      setStatus("recording");
      startTimer();

      // Open camera bubble (this hides the main window)
      try {
        await invoke("open_camera_bubble");
      } catch (bubbleErr) {
        // Bubble failed to open — main window stays visible as fallback
        console.warn("Camera bubble failed to open:", bubbleErr);
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError(String(err));
      setStatus("idle");
    }
  }, [setStatus, startTimer, setCurrentRecordingId, setError]);

  const handleStop = useCallback(async () => {
    stopTimer();
    setStatus("processing");
    try {
      const result = await invoke<StopResult>("stop_recording");
      addRecording({
        id: result.recording_id,
        title: "Sans titre",
        durationMs: result.duration_ms,
        createdAt: new Date().toISOString(),
        status: "ready",
        thumbnailUrl: null,
        shareUrl: null,
        outputPath: result.output_path,
      });
      setCurrentRecordingId(null);
      setStatus("idle");
      setElapsed(0);
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setError(String(err));
      setStatus("idle");
      setElapsed(0);
    }
  }, [stopTimer, setStatus, setElapsed, addRecording, setCurrentRecordingId, setError]);

  const handlePauseResume = useCallback(() => {
    if (status === "recording") {
      stopTimer();
      setStatus("paused");
    } else if (status === "paused") {
      startTimer();
      setStatus("recording");
    }
  }, [status, stopTimer, startTimer, setStatus]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (status === "countdown") {
    return <CountdownOverlay onComplete={handleCountdownComplete} />;
  }

  if (status === "processing") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div
            className="mb-4 text-lg font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Saving recording...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      {/* Error message */}
      {error && (
        <div
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#ef4444" }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Recording indicator */}
      <div className="flex items-center gap-3">
        <div
          className="h-3 w-3 rounded-full"
          style={{
            backgroundColor:
              status === "recording" ? "var(--color-danger)" : "#eab308",
            animation: status === "recording" ? "pulse 1.5s infinite" : "none",
          }}
        />
        <span className="text-sm font-medium uppercase tracking-wider">
          {status === "recording" ? "Recording" : "Paused"}
        </span>
      </div>

      {/* Timer */}
      <div className="text-6xl font-bold tabular-nums">{formatElapsed(elapsed)}</div>

      {/* Source indicator */}
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
        style={{
          backgroundColor: "var(--color-surface-elevated)",
          color: "var(--color-text-secondary)",
        }}
      >
        <Monitor size={14} />
        Full Screen
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={handlePauseResume}
          className="flex h-12 w-12 items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ backgroundColor: "var(--color-surface-elevated)" }}
          title={status === "recording" ? "Pause" : "Resume"}
        >
          {status === "recording" ? <Pause size={20} /> : <Play size={20} />}
        </button>

        <button
          onClick={handleStop}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white transition-colors"
          style={{ backgroundColor: "var(--color-danger)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--color-danger-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "var(--color-danger)")
          }
          title="Stop recording"
        >
          <Square size={22} fill="white" />
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
