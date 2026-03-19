import { create } from "zustand";

export type RecordingStatus =
  | "idle"
  | "countdown"
  | "recording"
  | "paused"
  | "processing"
  | "uploading"
  | "transcribing"
  | "summarizing";

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

export interface TranscriptionProgress {
  video_id: string;
  phase: "extracting_audio" | "loading_model" | "transcribing" | "uploading" | "done";
  percent: number;
}

export interface SummaryProgress {
  video_id: string;
  phase: "generating" | "uploading" | "done";
  percent: number;
}

export interface SummaryResult {
  title: string;
  summary: string;
  key_points: string[];
  action_items: string[];
  topics: string[];
  sentiment: string;
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
  // Transcription state
  transcriptionProgress: TranscriptionProgress | null;
  transcriptionText: string | null;
  // Whisper model state
  whisperModelReady: boolean;
  whisperDownloadPercent: number | null;
  // Summary state
  summaryProgress: SummaryProgress | null;
  summaryResult: SummaryResult | null;
  setStatus: (status: RecordingStatus) => void;
  setElapsed: (elapsed: number) => void;
  setRecordings: (recordings: Recording[]) => void;
  addRecording: (recording: Recording) => void;
  setCurrentRecordingId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setUploadProgress: (progress: UploadProgress | null) => void;
  setShareUrl: (url: string | null) => void;
  setTranscriptionProgress: (progress: TranscriptionProgress | null) => void;
  setTranscriptionText: (text: string | null) => void;
  setWhisperModelReady: (ready: boolean) => void;
  setWhisperDownloadPercent: (percent: number | null) => void;
  setSummaryProgress: (progress: SummaryProgress | null) => void;
  setSummaryResult: (result: SummaryResult | null) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  status: "idle",
  elapsed: 0,
  recordings: [],
  currentRecordingId: null,
  error: null,
  uploadProgress: null,
  shareUrl: null,
  transcriptionProgress: null,
  transcriptionText: null,
  whisperModelReady: false,
  whisperDownloadPercent: null,
  summaryProgress: null,
  summaryResult: null,
  setStatus: (status) => set({ status }),
  setElapsed: (elapsed) => set({ elapsed }),
  setRecordings: (recordings) => set({ recordings }),
  addRecording: (recording) =>
    set((state) => ({ recordings: [recording, ...state.recordings] })),
  setCurrentRecordingId: (currentRecordingId) => set({ currentRecordingId }),
  setError: (error) => set({ error }),
  setUploadProgress: (uploadProgress) => set({ uploadProgress }),
  setShareUrl: (shareUrl) => set({ shareUrl }),
  setTranscriptionProgress: (transcriptionProgress) => set({ transcriptionProgress }),
  setTranscriptionText: (transcriptionText) => set({ transcriptionText }),
  setWhisperModelReady: (whisperModelReady) => set({ whisperModelReady }),
  setWhisperDownloadPercent: (whisperDownloadPercent) => set({ whisperDownloadPercent }),
  setSummaryProgress: (summaryProgress) => set({ summaryProgress }),
  setSummaryResult: (summaryResult) => set({ summaryResult }),
}));
