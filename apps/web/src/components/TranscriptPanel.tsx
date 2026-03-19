import { useState, useEffect, useRef, useMemo } from "react";

export interface TranscriptWord {
  word: string;
  start_ms: number;
  end_ms: number;
  confidence: number | null;
}

interface TranscriptPanelProps {
  words: TranscriptWord[];
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Group words into segments (~10s each) for readability */
function groupIntoSegments(words: TranscriptWord[]): { startMs: number; words: TranscriptWord[] }[] {
  if (words.length === 0) return [];

  const segments: { startMs: number; words: TranscriptWord[] }[] = [];
  let current: TranscriptWord[] = [];
  let segStart = words[0].start_ms;

  for (const w of words) {
    if (current.length > 0 && w.start_ms - segStart >= 10000) {
      segments.push({ startMs: segStart, words: current });
      current = [];
      segStart = w.start_ms;
    }
    current.push(w);
  }

  if (current.length > 0) {
    segments.push({ startMs: segStart, words: current });
  }

  return segments;
}

export function TranscriptPanel({ words, currentTimeMs, onSeek }: TranscriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const segments = useMemo(() => groupIntoSegments(words), [words]);

  // Find which word is currently active
  const activeWordIndex = useMemo(() => {
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTimeMs >= words[i].start_ms && currentTimeMs <= words[i].end_ms) {
        return i;
      }
    }
    // If between words, find the closest preceding word
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTimeMs >= words[i].start_ms) {
        return i;
      }
    }
    return -1;
  }, [words, currentTimeMs]);

  // Search matches
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return new Set<number>();
    const q = searchQuery.toLowerCase();
    const matches = new Set<number>();
    words.forEach((w, i) => {
      if (w.word.toLowerCase().includes(q)) {
        matches.add(i);
      }
    });
    return matches;
  }, [words, searchQuery]);

  const matchCount = searchMatches.size;

  // Auto-scroll to active segment
  useEffect(() => {
    if (autoScroll && activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeWordIndex, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimer: ReturnType<typeof setTimeout>;
    const handler = () => {
      setAutoScroll(false);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => setAutoScroll(true), 5000);
    };

    container.addEventListener("scroll", handler, { passive: true });
    return () => {
      container.removeEventListener("scroll", handler);
      clearTimeout(scrollTimer);
    };
  }, []);

  // Track global word index across segments
  let globalWordIndex = 0;

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript..."
            className="w-full rounded-md border px-3 py-1.5 text-sm outline-none"
            style={{
              backgroundColor: "var(--color-surface)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
          {searchQuery && (
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </div>
          )}
        </div>
      </div>

      {/* Transcript body */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-3 py-2">
        {segments.length === 0 && (
          <p className="py-8 text-center text-sm" style={{ color: "var(--color-text-secondary)" }}>
            No transcription available.
          </p>
        )}

        {segments.map((seg, segIdx) => {
          const segStartIdx = globalWordIndex;
          const isActiveSegment =
            activeWordIndex >= segStartIdx && activeWordIndex < segStartIdx + seg.words.length;

          const segElement = (
            <div
              key={segIdx}
              ref={isActiveSegment ? activeSegmentRef : undefined}
              className="mb-3"
            >
              {/* Timestamp */}
              <button
                onClick={() => onSeek(seg.startMs)}
                className="mb-1 text-xs font-mono transition-colors hover:underline"
                style={{ color: "var(--color-primary)" }}
              >
                {formatTimestamp(seg.startMs)}
              </button>

              {/* Words */}
              <p className="text-sm leading-relaxed">
                {seg.words.map((w, wIdx) => {
                  const gIdx = segStartIdx + wIdx;
                  const isActive = gIdx === activeWordIndex;
                  const isSearchMatch = searchMatches.has(gIdx);

                  return (
                    <span
                      key={wIdx}
                      onClick={() => onSeek(w.start_ms)}
                      className="cursor-pointer rounded-sm transition-colors hover:bg-white/10"
                      style={{
                        color: isActive
                          ? "var(--color-primary)"
                          : isSearchMatch
                            ? "#fbbf24"
                            : "var(--color-text)",
                        backgroundColor: isActive
                          ? "rgba(99,102,241,0.15)"
                          : isSearchMatch
                            ? "rgba(251,191,36,0.15)"
                            : undefined,
                        fontWeight: isActive ? 600 : undefined,
                      }}
                    >
                      {w.word}{" "}
                    </span>
                  );
                })}
              </p>
            </div>
          );

          globalWordIndex += seg.words.length;
          return segElement;
        })}
      </div>
    </div>
  );
}
