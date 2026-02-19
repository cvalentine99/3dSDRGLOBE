/**
 * RecordingPlayback.tsx — Audio recording playback for TDoA jobs
 *
 * Displays a list of audio recordings captured from KiwiSDR hosts
 * during a TDoA job, with inline audio players and status indicators.
 */
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Mic,
  Loader2,
  AlertCircle,
  Download,
  Volume2,
  Radio,
  BarChart3,
  Fingerprint,
} from "lucide-react";
import SpectrogramView from "./SpectrogramView";
import FingerprintPanel from "./FingerprintPanel";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface RecordingPlaybackProps {
  /** TDoA job ID to fetch recordings for */
  jobId: number;
  /** Whether to show the record button to trigger new recordings */
  showRecordButton?: boolean;
  /** Host list for triggering new recordings */
  hosts?: Array<{ h: string; p: number }>;
  /** Frequency for new recordings */
  frequencyKhz?: number;
}

interface Recording {
  id: number;
  jobId: number;
  hostId: string;
  frequencyKhz: string;
  mode: string;
  durationSec: number;
  fileKey: string;
  fileUrl: string;
  fileSizeBytes: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: number;
}

export default function RecordingPlayback({
  jobId,
  showRecordButton = false,
  hosts = [],
  frequencyKhz = 10000,
}: RecordingPlaybackProps) {
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [spectrogramId, setSpectrogramId] = useState<number | null>(null);
  const [fingerprintRecording, setFingerprintRecording] = useState<Recording | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch recordings for this job
  const recordingsQuery = trpc.recordings.getByJob.useQuery(
    { jobId },
    { refetchInterval: 5000 }
  );

  // Start recording mutation
  const recordMutation = trpc.recordings.startRecording.useMutation({
    onSuccess: () => {
      recordingsQuery.refetch();
      toast.success("Recordings captured successfully");
    },
    onError: (err) => toast.error(`Recording failed: ${err.message}`),
  });

  const handleRecord = useCallback(() => {
    if (hosts.length === 0) {
      toast.error("No hosts available for recording");
      return;
    }
    recordMutation.mutate({
      jobId,
      hosts: hosts.map((h) => ({ h: h.h, p: h.p })),
      frequencyKhz,
      durationSec: 15,
    });
  }, [jobId, hosts, frequencyKhz, recordMutation]);

  const handlePlay = useCallback(
    (recording: Recording) => {
      if (playingId === recording.id) {
        // Pause
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }

      // Stop current
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Play new
      const audio = new Audio(recording.fileUrl);
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => {
        toast.error("Failed to play recording");
        setPlayingId(null);
      };
      audio.play();
      audioRef.current = audio;
      setPlayingId(recording.id);
    },
    [playingId]
  );

  const recordings = (recordingsQuery.data || []) as Recording[];
  const hasRecordings = recordings.length > 0;
  const isRecording = recordMutation.isPending;

  if (!hasRecordings && !showRecordButton) return null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Mic className="w-3 h-3" />
          Audio Recordings
        </h4>
        {showRecordButton && hosts.length > 0 && (
          <button
            onClick={handleRecord}
            disabled={isRecording}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-rose-500/15 border border-rose-500/25 text-rose-300 text-[10px] font-medium hover:bg-rose-500/25 disabled:opacity-40 transition-colors"
          >
            {isRecording ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Recording...
              </>
            ) : (
              <>
                <Mic className="w-3 h-3" />
                Record ({hosts.length} hosts)
              </>
            )}
          </button>
        )}
      </div>

      {/* Recording List */}
      {recordingsQuery.isLoading ? (
        <div className="flex items-center gap-2 py-3">
          <Loader2 className="w-3.5 h-3.5 text-white/30 animate-spin" />
          <span className="text-[10px] text-white/30">Loading recordings...</span>
        </div>
      ) : !hasRecordings ? (
        <div className="rounded-md bg-white/[0.02] border border-dashed border-white/10 p-4 text-center">
          <Mic className="w-5 h-5 text-white/10 mx-auto mb-1.5" />
          <p className="text-[10px] text-white/25">
            No recordings yet. Click Record to capture audio from each host.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {recordings.map((rec) => {
            const isPlaying = playingId === rec.id;
            const isReady = rec.status === "ready";
            const isError = rec.status === "error";
            const isInProgress = rec.status === "recording" || rec.status === "uploading";
            const sizeKb = rec.fileSizeBytes ? Math.round(rec.fileSizeBytes / 1024) : 0;

            return (
              <div key={rec.id}>
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md border transition-colors ${
                  isPlaying
                    ? "bg-rose-500/10 border-rose-500/25"
                    : isError
                    ? "bg-red-500/5 border-red-500/15"
                    : "bg-white/[0.03] border-white/5 hover:bg-white/[0.05]"
                }`}
              >
                {/* Play/Status button */}
                <button
                  onClick={() => isReady && handlePlay(rec)}
                  disabled={!isReady}
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                    isPlaying
                      ? "bg-rose-500/30 text-rose-300"
                      : isReady
                      ? "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80"
                      : isError
                      ? "bg-red-500/15 text-red-400"
                      : "bg-white/5 text-white/20"
                  }`}
                >
                  {isInProgress ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isError ? (
                    <AlertCircle className="w-3.5 h-3.5" />
                  ) : isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5" />
                  )}
                </button>

                {/* Host info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono text-white/70 truncate">
                    {rec.hostId}
                  </p>
                  <p className="text-[9px] font-mono text-white/30">
                    {parseFloat(rec.frequencyKhz)} kHz · {rec.mode.toUpperCase()} · {rec.durationSec}s
                    {sizeKb > 0 && ` · ${sizeKb} KB`}
                  </p>
                  {isError && rec.errorMessage && (
                    <p className="text-[9px] text-red-400/60 truncate mt-0.5">
                      {rec.errorMessage}
                    </p>
                  )}
                </div>

                {/* Waveform indicator (when playing) */}
                {isPlaying && (
                  <div className="flex items-end gap-0.5 h-4 flex-shrink-0">
                    {[0.6, 1, 0.4, 0.8, 0.5].map((h, i) => (
                      <div
                        key={i}
                        className="w-0.5 bg-rose-400 rounded-full animate-pulse"
                        style={{
                          height: `${h * 100}%`,
                          animationDelay: `${i * 0.15}s`,
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Spectrogram toggle */}
                {isReady && (
                  <button
                    onClick={() => setSpectrogramId(spectrogramId === rec.id ? null : rec.id)}
                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors flex-shrink-0 ${
                      spectrogramId === rec.id
                        ? "text-cyan-400 bg-cyan-500/15"
                        : "text-white/20 hover:text-white/50"
                    }`}
                    title="Toggle spectrogram"
                  >
                    <BarChart3 className="w-3 h-3" />
                  </button>
                )}

                {/* Fingerprint button */}
                {isReady && (
                  <button
                    onClick={() => setFingerprintRecording(rec)}
                    className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:text-purple-400 transition-colors flex-shrink-0"
                    title="Signal fingerprint"
                  >
                    <Fingerprint className="w-3 h-3" />
                  </button>
                )}

                {/* Download button */}
                {isReady && (
                  <a
                    href={rec.fileUrl}
                    download
                    className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:text-white/50 transition-colors flex-shrink-0"
                    title="Download WAV"
                  >
                    <Download className="w-3 h-3" />
                  </a>
                )}
              </motion.div>

              {/* Spectrogram view (expanded below the recording row) */}
              <AnimatePresence>
                {spectrogramId === rec.id && isReady && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-2 pt-1">
                      <SpectrogramView
                        audioUrl={rec.fileUrl}
                        height={140}
                        label={`${rec.hostId} · ${parseFloat(rec.frequencyKhz)} kHz`}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
      {/* Fingerprint Panel Modal */}
      {fingerprintRecording && (
        <FingerprintPanel
          isOpen={true}
          onClose={() => setFingerprintRecording(null)}
          recordingUrl={fingerprintRecording.fileUrl}
          recordingId={fingerprintRecording.id}
          frequencyKhz={parseFloat(fingerprintRecording.frequencyKhz)}
          mode={fingerprintRecording.mode}
        />
      )}
    </div>
  );
}
