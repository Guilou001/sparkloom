import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Square, Pause, Play, VideoOff } from "lucide-react";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface CaptureStatus {
  status: string;
  video_frames: number;
  audio_buffers: number;
  duration_ms: number;
}

export function CameraBubble() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [webcamActive, setWebcamActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Set dark background for the bubble window
  useEffect(() => {
    document.documentElement.style.background = "#111827";
    document.body.style.background = "#111827";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  // Initialize webcam
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({
        video: { width: 320, height: 320, facingMode: "user" },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setWebcamActive(true);
      })
      .catch((err) => {
        console.error("Failed to access camera:", err);
        setWebcamActive(false);
      });

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Timer: sync with capture engine then count locally
  useEffect(() => {
    invoke<CaptureStatus>("get_capture_status")
      .then((status) => {
        setElapsed(Math.floor(status.duration_ms / 1000));
      })
      .catch(() => {});

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Pause/resume timer
  useEffect(() => {
    if (paused && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    } else if (!paused && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    }
  }, [paused]);

  const handleStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await invoke("stop_and_close_bubble");
    } catch (err) {
      console.error("Failed to stop:", err);
      setStopping(false);
    }
  }, [stopping]);

  const handlePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex flex-col items-center gap-3"
      style={{
        background: "#111827",
        padding: "16px",
        width: "220px",
        height: "280px",
        cursor: "grab",
        borderRadius: "20px",
        overflow: "hidden",
      }}
    >
      {/* Webcam circle */}
      <div data-tauri-drag-region className="relative">
        <div
          className="overflow-hidden rounded-full shadow-2xl"
          style={{
            width: "160px",
            height: "160px",
            border: "3px solid rgba(255,255,255,0.15)",
          }}
        >
          {webcamActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ backgroundColor: "#1f2937" }}
            >
              <VideoOff size={32} style={{ color: "#6b7280" }} />
            </div>
          )}
        </div>

        {/* Recording indicator badge */}
        <div
          className="absolute flex items-center gap-1 rounded-full px-2 py-0.5 shadow-lg"
          style={{
            top: "-4px",
            right: "-4px",
            backgroundColor: "#ef4444",
          }}
        >
          <div
            className="rounded-full"
            style={{
              width: "6px",
              height: "6px",
              backgroundColor: "white",
              animation: paused ? "none" : "pulse 1.5s infinite",
            }}
          />
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: "white",
              letterSpacing: "0.05em",
            }}
          >
            {paused ? "PAUSE" : "REC"}
          </span>
        </div>
      </div>

      {/* Controls bar */}
      <div
        className="flex items-center gap-2 rounded-full px-3 shadow-xl"
        style={{
          backgroundColor: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(12px)",
          height: "36px",
        }}
      >
        {/* Timer */}
        <span
          className="tabular-nums"
          style={{
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: 500,
            color: "rgba(255,255,255,0.9)",
            minWidth: "42px",
          }}
        >
          {formatElapsed(elapsed)}
        </span>

        {/* Separator */}
        <div
          style={{
            width: "1px",
            height: "16px",
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        />

        {/* Pause/Resume */}
        <button
          onClick={handlePause}
          className="flex items-center justify-center rounded-full transition-colors"
          style={{
            width: "28px",
            height: "28px",
            color: "rgba(255,255,255,0.8)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "transparent")
          }
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          disabled={stopping}
          className="flex items-center justify-center rounded-full transition-colors"
          style={{
            width: "28px",
            height: "28px",
            backgroundColor: "#ef4444",
            color: "white",
            border: "none",
            cursor: stopping ? "wait" : "pointer",
            opacity: stopping ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!stopping) e.currentTarget.style.backgroundColor = "#dc2626";
          }}
          onMouseLeave={(e) => {
            if (!stopping) e.currentTarget.style.backgroundColor = "#ef4444";
          }}
          title="Stop recording"
        >
          <Square size={12} fill="white" />
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
