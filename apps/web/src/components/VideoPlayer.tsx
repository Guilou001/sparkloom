import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Hls from "hls.js";

interface VideoPlayerProps {
  manifestUrl: string;
  autoPlay?: boolean;
  onTimeUpdate?: (currentTimeMs: number) => void;
}

export interface VideoPlayerHandle {
  seekTo: (timeMs: number) => void;
  getCurrentTime: () => number;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ manifestUrl, autoPlay = false, onTimeUpdate }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);

    useImperativeHandle(ref, () => ({
      seekTo(timeMs: number) {
        if (videoRef.current) {
          videoRef.current.currentTime = timeMs / 1000;
        }
      },
      getCurrentTime() {
        return (videoRef.current?.currentTime ?? 0) * 1000;
      },
    }));

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !onTimeUpdate) return;

      const handler = () => {
        onTimeUpdate(video.currentTime * 1000);
      };

      video.addEventListener("timeupdate", handler);
      return () => video.removeEventListener("timeupdate", handler);
    }, [onTimeUpdate]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });

        hls.loadSource(manifestUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoPlay) {
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error("HLS network error, trying to recover...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error("HLS media error, trying to recover...");
                hls.recoverMediaError();
                break;
              default:
                console.error("HLS fatal error:", data);
                hls.destroy();
                break;
            }
          }
        });

        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = manifestUrl;
        if (autoPlay) {
          video.play().catch(() => {});
        }
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [manifestUrl, autoPlay]);

    return (
      <video
        ref={videoRef}
        controls
        playsInline
        className="h-full w-full rounded-lg"
        style={{ backgroundColor: "#000" }}
      />
    );
  }
);
