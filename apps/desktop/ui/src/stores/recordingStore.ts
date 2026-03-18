import { create } from "zustand";

export type RecordingStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "processing"
  | "uploading";

export interface Recording {
  id: string;
  title: string;
  durationMs: number | null;
  createdAt: string;
  status: string;
  thumbnailUrl: string | null;
  shareUrl: string | null;
  outputPath?: string;
}

export interface StartResult {
  recording_id: string;
  output_path: string;
}

export interface StopResult {
  recording_id: string;
  output_path: string;
  duration_ms: number;
  video_frames: number;
  audio_buffers: number;
}

export interface UploadProgress {
  video_id: string;
  phase: "init" | "segments" | "finalizing" | "done" | "error";
  uploaded: number;
  total: number;
  error: string | null;
}

interface RecordingState {
  status: RecordingStatus;
  elapsed: number;
  recordings: Recording[];
  currentRecordingId: string | null;
  error: string | null;
  // Upload state
  uploadProgress: UploadProgress | null;
  shareUrl: string | null;
  setStatus: (status: RecordingStatus) => void;
  setElapsed: (elapsed: number) => void;
  setRecordings: (recordings: Recording[]) => void;
  addRecording: (recording: Recording) => void;
  setCurrentRecordingId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setUploadProgress: (progress: UploadProgress | null) => void;
  setShareUrl: (url: string | null) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  status: "idle",
  elapsed: 0,
  recordings: [],
  currentRecordingId: null,
  error: null,
  uploadProgress: null,
  shareUrl: null,
  setStatus: (status) => set({ status }),
  setElapsed: (elapsed) => set({ elapsed }),
  setRecordings: (recordings) => set({ recordings }),
  addRecording: (recording) =>
    set((state) => ({ recordings: [recording, ...state.recordings] })),
  setCurrentRecordingId: (currentRecordingId) => set({ currentRecordingId }),
  setError: (error) => set({ error }),
  setUploadProgress: (uploadProgress) => set({ uploadProgress }),
  setShareUrl: (shareUrl) => set({ shareUrl }),
}));
