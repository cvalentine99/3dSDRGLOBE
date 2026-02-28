/**
 * translation.ts — Live audio translation router
 * Uses the platform Whisper API to transcribe and translate radio audio to English.
 * Mirrors the double-buffer approach from the local translate.py script:
 *   Browser records chunk N+1 while server translates chunk N.
 *
 * Endpoints:
 *   translate.translateChunk  — Upload audio chunk, get English translation
 *   translate.transcribeChunk — Upload audio chunk, get same-language transcription
 *   translate.getLanguages    — List supported source languages
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { storagePut } from "../storage";
import { TRPCError } from "@trpc/server";

// ── Supported languages (Whisper ISO-639-1 codes) ──────────────────────────
const SUPPORTED_LANGUAGES: { code: string; name: string; nativeName: string }[] = [
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "fa", name: "Persian", nativeName: "فارسی" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
];

// ── Whisper API response types ──────────────────────────────────────────────
interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

interface WhisperResponse {
  task: "transcribe" | "translate";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
}

// ── Core Whisper API call ───────────────────────────────────────────────────
async function callWhisperApi(
  audioUrl: string,
  task: "transcribe" | "translate",
  language?: string,
): Promise<WhisperResponse> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Translation service not configured",
    });
  }

  // Download audio from S3
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to fetch audio: ${audioResponse.status}`,
    });
  }

  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  const sizeMB = audioBuffer.length / (1024 * 1024);
  if (sizeMB > 16) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `Audio chunk too large: ${sizeMB.toFixed(1)}MB (max 16MB)`,
    });
  }

  // Build FormData for Whisper API
  const mimeType = audioResponse.headers.get("content-type") || "audio/webm";
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp3") ? "mp3" : "wav";
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });

  const formData = new FormData();
  formData.append("file", audioBlob, `chunk.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");

  if (language) {
    formData.append("language", language);
  }

  // Choose endpoint: translations (→ English) or transcriptions (same language)
  const baseUrl = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
  const endpoint = task === "translate" ? "v1/audio/translations" : "v1/audio/transcriptions";
  const fullUrl = new URL(endpoint, baseUrl).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.forgeApiKey}`,
      "Accept-Encoding": "identity",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    // If translations endpoint not available, fall back to transcriptions + note
    if (response.status === 404 && task === "translate") {
      console.warn("[Translation] v1/audio/translations not available, falling back to transcriptions");
      return callWhisperApi(audioUrl, "transcribe", language);
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Whisper API error ${response.status}: ${errorText}`,
    });
  }

  return (await response.json()) as WhisperResponse;
}

// ── Router ──────────────────────────────────────────────────────────────────
export const translationRouter = router({
  /**
   * Translate an audio chunk to English.
   * Input: base64-encoded audio data + metadata
   * Output: English text with timestamped segments
   */
  translateChunk: publicProcedure
    .input(
      z.object({
        audioBase64: z.string().describe("Base64-encoded audio chunk"),
        mimeType: z.string().default("audio/webm"),
        language: z.string().optional().describe("Source language ISO-639-1 code"),
        chunkIndex: z.number().int().min(0).describe("Sequential chunk number"),
        stationLabel: z.string().optional().describe("Station being listened to"),
      }),
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      // Decode base64 audio
      const audioBuffer = Buffer.from(input.audioBase64, "base64");
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Audio chunk too large: ${sizeMB.toFixed(1)}MB (max 16MB)`,
        });
      }

      // Upload to S3 with unique key
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = input.mimeType.includes("webm") ? "webm" : input.mimeType.includes("mp3") ? "mp3" : "wav";
      const fileKey = `translation-chunks/${suffix}.${ext}`;

      const { url: audioUrl } = await storagePut(fileKey, audioBuffer, input.mimeType);

      // Call Whisper translation API
      const result = await callWhisperApi(audioUrl, "translate", input.language);

      const processingTime = Date.now() - startTime;

      return {
        text: result.text.trim(),
        segments: result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
        })),
        detectedLanguage: result.language,
        duration: result.duration,
        chunkIndex: input.chunkIndex,
        processingTimeMs: processingTime,
        task: result.task,
      };
    }),

  /**
   * Transcribe an audio chunk in its original language (no translation).
   */
  transcribeChunk: publicProcedure
    .input(
      z.object({
        audioBase64: z.string(),
        mimeType: z.string().default("audio/webm"),
        language: z.string().optional(),
        chunkIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      const audioBuffer = Buffer.from(input.audioBase64, "base64");
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Audio chunk too large: ${sizeMB.toFixed(1)}MB (max 16MB)`,
        });
      }

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = input.mimeType.includes("webm") ? "webm" : "wav";
      const fileKey = `translation-chunks/${suffix}.${ext}`;

      const { url: audioUrl } = await storagePut(fileKey, audioBuffer, input.mimeType);
      const result = await callWhisperApi(audioUrl, "transcribe", input.language);

      return {
        text: result.text.trim(),
        segments: result.segments.map((s) => ({
          start: s.start,
          end: s.end,
          text: s.text.trim(),
        })),
        detectedLanguage: result.language,
        duration: result.duration,
        chunkIndex: input.chunkIndex,
        processingTimeMs: Date.now() - startTime,
        task: result.task,
      };
    }),

  /**
   * Dual-language mode: transcribe in original language AND translate to English
   * in parallel for the same audio chunk. Returns both texts for side-by-side display.
   */
  dualTranslateChunk: publicProcedure
    .input(
      z.object({
        audioBase64: z.string().describe("Base64-encoded audio chunk"),
        mimeType: z.string().default("audio/webm"),
        language: z.string().optional().describe("Source language ISO-639-1 code"),
        chunkIndex: z.number().int().min(0).describe("Sequential chunk number"),
        stationLabel: z.string().optional().describe("Station being listened to"),
      }),
    )
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      // Decode base64 audio
      const audioBuffer = Buffer.from(input.audioBase64, "base64");
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Audio chunk too large: ${sizeMB.toFixed(1)}MB (max 16MB)`,
        });
      }

      // Upload to S3 once — both calls share the same audio URL
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = input.mimeType.includes("webm") ? "webm" : input.mimeType.includes("mp3") ? "mp3" : "wav";
      const fileKey = `translation-chunks/dual-${suffix}.${ext}`;
      const { url: audioUrl } = await storagePut(fileKey, audioBuffer, input.mimeType);

      // Run transcription and translation in parallel
      const [transcribeResult, translateResult] = await Promise.allSettled([
        callWhisperApi(audioUrl, "transcribe", input.language),
        callWhisperApi(audioUrl, "translate", input.language),
      ]);

      const processingTime = Date.now() - startTime;

      // Extract results — gracefully handle partial failures
      const original =
        transcribeResult.status === "fulfilled"
          ? {
              text: transcribeResult.value.text.trim(),
              segments: transcribeResult.value.segments.map((s) => ({
                start: s.start,
                end: s.end,
                text: s.text.trim(),
              })),
              language: transcribeResult.value.language,
              duration: transcribeResult.value.duration,
            }
          : null;

      const translated =
        translateResult.status === "fulfilled"
          ? {
              text: translateResult.value.text.trim(),
              segments: translateResult.value.segments.map((s) => ({
                start: s.start,
                end: s.end,
                text: s.text.trim(),
              })),
              language: translateResult.value.language,
              duration: translateResult.value.duration,
              task: translateResult.value.task,
            }
          : null;

      // At least one must succeed
      if (!original && !translated) {
        const err =
          transcribeResult.status === "rejected"
            ? transcribeResult.reason
            : translateResult.status === "rejected"
              ? translateResult.reason
              : new Error("Both transcription and translation failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Dual translation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const detectedLanguage = original?.language || translated?.language || "unknown";
      const duration = original?.duration || translated?.duration || 0;

      return {
        original: original
          ? { text: original.text, segments: original.segments }
          : null,
        translated: translated
          ? { text: translated.text, segments: translated.segments, task: translated.task }
          : null,
        detectedLanguage,
        duration,
        chunkIndex: input.chunkIndex,
        processingTimeMs: processingTime,
        isEnglishSource: detectedLanguage === "en",
      };
    }),

  /**
   * Get list of supported source languages.
   */
  getLanguages: publicProcedure.query(() => {
    return SUPPORTED_LANGUAGES;
  }),
});
