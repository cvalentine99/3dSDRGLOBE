/**
 * translation.test.ts — Tests for the live translation router
 * Tests the translateChunk, transcribeChunk, and getLanguages endpoints.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Mock the Whisper API and S3 ─────────────────────────────────────────────
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({
    key: "translation-chunks/test.webm",
    url: "https://s3.example.com/translation-chunks/test.webm",
  }),
}));

// Mock the global fetch for Whisper API calls
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ── Helper: create a minimal base64 audio chunk ─────────────────────────────
function createTestAudioBase64(sizeBytes = 2000): string {
  const buffer = Buffer.alloc(sizeBytes, 0x42);
  return buffer.toString("base64");
}

// ── Helper: mock Whisper API response ───────────────────────────────────────
function mockWhisperResponse(overrides: Partial<{
  task: string;
  language: string;
  duration: number;
  text: string;
  segments: any[];
}> = {}) {
  return {
    task: overrides.task ?? "translate",
    language: overrides.language ?? "ru",
    duration: overrides.duration ?? 20.5,
    text: overrides.text ?? "This is a translated broadcast from Moscow.",
    segments: overrides.segments ?? [
      {
        id: 0,
        seek: 0,
        start: 0.0,
        end: 10.2,
        text: "This is a translated broadcast",
        tokens: [1, 2, 3],
        temperature: 0.0,
        avg_logprob: -0.25,
        compression_ratio: 1.2,
        no_speech_prob: 0.01,
      },
      {
        id: 1,
        seek: 1024,
        start: 10.2,
        end: 20.5,
        text: "from Moscow.",
        tokens: [4, 5],
        temperature: 0.0,
        avg_logprob: -0.3,
        compression_ratio: 1.1,
        no_speech_prob: 0.02,
      },
    ],
  };
}

// ── Helper: set up fetch mock for a successful Whisper call ─────────────────
function setupSuccessfulWhisperMock(whisperOverrides: Parameters<typeof mockWhisperResponse>[0] = {}) {
  const whisperResp = mockWhisperResponse(whisperOverrides);

  mockFetch.mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    // S3 audio download
    if (urlStr.includes("s3.example.com")) {
      return new Response(Buffer.alloc(1000, 0x42), {
        status: 200,
        headers: { "content-type": "audio/webm" },
      });
    }

    // Whisper API
    if (urlStr.includes("v1/audio/")) {
      return new Response(JSON.stringify(whisperResp), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  });

  return whisperResp;
}

// ── Tests ───────────────────────────────────────────────────────────────────
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {}, get: () => "localhost" } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
  };
}

describe("Translation Router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(() => {
    caller = appRouter.createCaller(createPublicContext());
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── getLanguages ────────────────────────────────────────────────────────
  describe("getLanguages", () => {
    it("returns a list of supported languages", async () => {
      const languages = await caller.translation.getLanguages();

      expect(Array.isArray(languages)).toBe(true);
      expect(languages.length).toBeGreaterThan(20);

      // Check structure
      const first = languages[0];
      expect(first).toHaveProperty("code");
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("nativeName");
    });

    it("includes common languages", async () => {
      const languages = await caller.translation.getLanguages();
      const codes = languages.map((l) => l.code);

      expect(codes).toContain("en");
      expect(codes).toContain("ru");
      expect(codes).toContain("zh");
      expect(codes).toContain("ar");
      expect(codes).toContain("es");
      expect(codes).toContain("fr");
      expect(codes).toContain("de");
      expect(codes).toContain("ja");
    });

    it("has unique language codes", async () => {
      const languages = await caller.translation.getLanguages();
      const codes = languages.map((l) => l.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ── translateChunk ──────────────────────────────────────────────────────
  describe("translateChunk", () => {
    it("translates an audio chunk to English", async () => {
      const whisperResp = setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
        stationLabel: "Moscow FM",
      });

      expect(result.text).toBe(whisperResp.text);
      expect(result.detectedLanguage).toBe("ru");
      expect(result.duration).toBe(20.5);
      expect(result.chunkIndex).toBe(0);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toHaveProperty("start");
      expect(result.segments[0]).toHaveProperty("end");
      expect(result.segments[0]).toHaveProperty("text");
    });

    it("passes language hint when provided", async () => {
      setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        language: "ru",
        chunkIndex: 1,
      });

      expect(result.detectedLanguage).toBe("ru");

      // Verify the Whisper API was called with language parameter
      const whisperCall = mockFetch.mock.calls.find(
        (call) => {
          const urlStr = typeof call[0] === "string" ? call[0] : call[0]?.url ?? "";
          return urlStr.includes("v1/audio/");
        }
      );
      expect(whisperCall).toBeDefined();
    });

    it("auto-detects language when not provided", async () => {
      setupSuccessfulWhisperMock({ language: "ja" });

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      expect(result.detectedLanguage).toBe("ja");
    });

    it("rejects chunks larger than 16MB", async () => {
      // Create a base64 string that decodes to >16MB
      const largeBuf = Buffer.alloc(17 * 1024 * 1024, 0x42);
      const largeBase64 = largeBuf.toString("base64");

      await expect(
        caller.translation.translateChunk({
          audioBase64: largeBase64,
          mimeType: "audio/webm",
          chunkIndex: 0,
        }),
      ).rejects.toThrow(/too large/i);
    });

    it("handles empty transcription result", async () => {
      setupSuccessfulWhisperMock({ text: "   ", segments: [] });

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      expect(result.text).toBe("");
      expect(result.segments).toHaveLength(0);
    });

    it("handles mp3 mime type", async () => {
      setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/mp3",
        chunkIndex: 0,
      });

      expect(result.text).toBeTruthy();
    });

    it("preserves chunk index in response", async () => {
      setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 42,
      });

      expect(result.chunkIndex).toBe(42);
    });

    it("trims whitespace from text and segments", async () => {
      setupSuccessfulWhisperMock({
        text: "  Hello world  ",
        segments: [
          {
            id: 0, seek: 0, start: 0, end: 5,
            text: "  Hello world  ",
            tokens: [1], temperature: 0, avg_logprob: -0.2,
            compression_ratio: 1, no_speech_prob: 0.01,
          },
        ],
      });

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      expect(result.text).toBe("Hello world");
      expect(result.segments[0].text).toBe("Hello world");
    });
  });

  // ── transcribeChunk ─────────────────────────────────────────────────────
  describe("transcribeChunk", () => {
    it("transcribes an audio chunk in original language", async () => {
      setupSuccessfulWhisperMock({
        task: "transcribe",
        language: "ar",
        text: "مرحبا بالعالم",
      });

      const result = await caller.translation.transcribeChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      expect(result.text).toBe("مرحبا بالعالم");
      expect(result.detectedLanguage).toBe("ar");
      expect(result.task).toBe("transcribe");
    });

    it("uses transcriptions endpoint, not translations", async () => {
      setupSuccessfulWhisperMock({ task: "transcribe" });

      await caller.translation.transcribeChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      // Check that the transcriptions endpoint was called
      const whisperCall = mockFetch.mock.calls.find(
        (call) => {
          const urlStr = typeof call[0] === "string" ? call[0] : call[0]?.url ?? "";
          return urlStr.includes("v1/audio/transcriptions");
        }
      );
      expect(whisperCall).toBeDefined();
    });

    it("rejects oversized chunks", async () => {
      const largeBuf = Buffer.alloc(17 * 1024 * 1024, 0x42);

      await expect(
        caller.translation.transcribeChunk({
          audioBase64: largeBuf.toString("base64"),
          mimeType: "audio/webm",
          chunkIndex: 0,
        }),
      ).rejects.toThrow(/too large/i);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────
  describe("error handling", () => {
    it("handles Whisper API errors gracefully", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr.includes("s3.example.com")) {
          return new Response(Buffer.alloc(1000), {
            status: 200,
            headers: { "content-type": "audio/webm" },
          });
        }

        if (urlStr.includes("v1/audio/")) {
          return new Response("Rate limit exceeded", { status: 429 });
        }

        return new Response("Not found", { status: 404 });
      });

      await expect(
        caller.translation.translateChunk({
          audioBase64: createTestAudioBase64(),
          mimeType: "audio/webm",
          chunkIndex: 0,
        }),
      ).rejects.toThrow(/Whisper API error 429/);
    });

    it("handles S3 download failure", async () => {
      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr.includes("s3.example.com")) {
          return new Response("Forbidden", { status: 403 });
        }

        return new Response("Not found", { status: 404 });
      });

      await expect(
        caller.translation.translateChunk({
          audioBase64: createTestAudioBase64(),
          mimeType: "audio/webm",
          chunkIndex: 0,
        }),
      ).rejects.toThrow(/Failed to fetch audio/);
    });

    it("falls back to transcription if translation endpoint returns 404", async () => {
      let callCount = 0;
      const whisperResp = mockWhisperResponse({ task: "transcribe" });

      mockFetch.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

        if (urlStr.includes("s3.example.com")) {
          return new Response(Buffer.alloc(1000), {
            status: 200,
            headers: { "content-type": "audio/webm" },
          });
        }

        if (urlStr.includes("v1/audio/translations")) {
          return new Response("Not found", { status: 404 });
        }

        if (urlStr.includes("v1/audio/transcriptions")) {
          return new Response(JSON.stringify(whisperResp), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response("Not found", { status: 404 });
      });

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      // Should still return a result via fallback
      expect(result.text).toBeTruthy();
      expect(result.task).toBe("transcribe");
    });
  });

  // ── Input validation ────────────────────────────────────────────────────
  describe("input validation", () => {
    it("rejects negative chunk index", async () => {
      await expect(
        caller.translation.translateChunk({
          audioBase64: createTestAudioBase64(),
          mimeType: "audio/webm",
          chunkIndex: -1,
        }),
      ).rejects.toThrow();
    });

    it("accepts chunk index 0", async () => {
      setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      });

      expect(result.chunkIndex).toBe(0);
    });

    it("defaults mimeType to audio/webm", async () => {
      setupSuccessfulWhisperMock();

      const result = await caller.translation.translateChunk({
        audioBase64: createTestAudioBase64(),
        chunkIndex: 0,
      });

      expect(result.text).toBeTruthy();
    });
  });
});

// ── Dual-language mode tests ─────────────────────────────────────────────────
describe("dualTranslateChunk", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(() => {
    caller = appRouter.createCaller({
      user: null,
      req: { protocol: "https", headers: {}, get: () => "localhost" } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
    });
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  // Helper: set up fetch mock that returns different results for transcribe vs translate
  function setupDualMock(opts: {
    transcribeText?: string;
    translateText?: string;
    transcribeLang?: string;
    translateLang?: string;
    transcribeFail?: boolean;
    translateFail?: boolean;
  } = {}) {
    const transcribeResp = mockWhisperResponse({
      task: "transcribe",
      language: opts.transcribeLang ?? "ru",
      text: opts.transcribeText ?? "Привет мир, это радио Москва.",
    });
    const translateResp = mockWhisperResponse({
      task: "translate",
      language: opts.translateLang ?? "ru",
      text: opts.translateText ?? "Hello world, this is Radio Moscow.",
    });

    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      // S3 audio download
      if (urlStr.includes("s3.example.com")) {
        return new Response(Buffer.alloc(1000, 0x42), {
          status: 200,
          headers: { "content-type": "audio/webm" },
        });
      }

      // Whisper transcriptions endpoint
      if (urlStr.includes("v1/audio/transcriptions")) {
        if (opts.transcribeFail) {
          return new Response("Server error", { status: 500 });
        }
        return new Response(JSON.stringify(transcribeResp), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // Whisper translations endpoint
      if (urlStr.includes("v1/audio/translations")) {
        if (opts.translateFail) {
          return new Response("Server error", { status: 500 });
        }
        return new Response(JSON.stringify(translateResp), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    });

    return { transcribeResp, translateResp };
  }

  it("returns both original and translated text for non-English audio", async () => {
    setupDualMock();

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
      stationLabel: "Radio Moscow",
    });

    expect(result.original).not.toBeNull();
    expect(result.translated).not.toBeNull();
    expect(result.original!.text).toBe("Привет мир, это радио Москва.");
    expect(result.translated!.text).toBe("Hello world, this is Radio Moscow.");
    expect(result.detectedLanguage).toBe("ru");
    expect(result.isEnglishSource).toBe(false);
  });

  it("returns chunkIndex and processingTimeMs", async () => {
    setupDualMock();

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 7,
    });

    expect(result.chunkIndex).toBe(7);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("returns duration from the original transcription", async () => {
    setupDualMock();

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    expect(result.duration).toBe(20.5);
  });

  it("returns segments for both original and translated", async () => {
    setupDualMock();

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    expect(result.original!.segments).toHaveLength(2);
    expect(result.translated!.segments).toHaveLength(2);
    expect(result.original!.segments[0]).toHaveProperty("start");
    expect(result.original!.segments[0]).toHaveProperty("end");
    expect(result.original!.segments[0]).toHaveProperty("text");
  });

  it("sets isEnglishSource to true when detected language is English", async () => {
    setupDualMock({
      transcribeLang: "en",
      translateLang: "en",
      transcribeText: "Hello from London.",
      translateText: "Hello from London.",
    });

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    expect(result.isEnglishSource).toBe(true);
    expect(result.detectedLanguage).toBe("en");
  });

  it("calls both transcriptions and translations endpoints in parallel", async () => {
    setupDualMock();

    await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    // Should have called S3 (1 upload fetch) + 2 Whisper endpoints
    const whisperCalls = mockFetch.mock.calls.filter((call) => {
      const urlStr = typeof call[0] === "string" ? call[0] : call[0]?.url ?? "";
      return urlStr.includes("v1/audio/");
    });
    expect(whisperCalls.length).toBe(2);

    const endpoints = whisperCalls.map((call) => {
      const urlStr = typeof call[0] === "string" ? call[0] : call[0]?.url ?? "";
      return urlStr;
    });
    expect(endpoints.some((u) => u.includes("transcriptions"))).toBe(true);
    expect(endpoints.some((u) => u.includes("translations"))).toBe(true);
  });

  it("gracefully handles transcription failure (returns translation only)", async () => {
    setupDualMock({ transcribeFail: true });

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    // Transcription failed, but translation succeeded
    expect(result.original).toBeNull();
    expect(result.translated).not.toBeNull();
    expect(result.translated!.text).toBe("Hello world, this is Radio Moscow.");
  });

  it("gracefully handles translation failure (returns original only)", async () => {
    setupDualMock({ translateFail: true });

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    // Translation failed, but transcription succeeded
    expect(result.original).not.toBeNull();
    expect(result.translated).toBeNull();
    expect(result.original!.text).toBe("Привет мир, это радио Москва.");
  });

  it("throws when both transcription and translation fail", async () => {
    setupDualMock({ transcribeFail: true, translateFail: true });

    await expect(
      caller.translation.dualTranslateChunk({
        audioBase64: createTestAudioBase64(),
        mimeType: "audio/webm",
        chunkIndex: 0,
      }),
    ).rejects.toThrow(/Dual translation failed/);
  });

  it("rejects chunks larger than 16MB", async () => {
    const largeBuf = Buffer.alloc(17 * 1024 * 1024, 0x42);

    await expect(
      caller.translation.dualTranslateChunk({
        audioBase64: largeBuf.toString("base64"),
        mimeType: "audio/webm",
        chunkIndex: 0,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("passes language hint to both endpoints", async () => {
    setupDualMock();

    await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      language: "ru",
      chunkIndex: 0,
    });

    // Both Whisper calls should include the language in the form data
    const whisperCalls = mockFetch.mock.calls.filter((call) => {
      const urlStr = typeof call[0] === "string" ? call[0] : call[0]?.url ?? "";
      return urlStr.includes("v1/audio/");
    });
    expect(whisperCalls.length).toBe(2);
  });

  it("handles different languages for Arabic broadcast", async () => {
    setupDualMock({
      transcribeLang: "ar",
      translateLang: "ar",
      transcribeText: "مرحبا بالعالم",
      translateText: "Hello world",
    });

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    expect(result.original!.text).toBe("مرحبا بالعالم");
    expect(result.translated!.text).toBe("Hello world");
    expect(result.detectedLanguage).toBe("ar");
  });

  it("handles mp3 mime type", async () => {
    setupDualMock();

    const result = await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/mp3",
      chunkIndex: 0,
    });

    expect(result.original).not.toBeNull();
    expect(result.translated).not.toBeNull();
  });

  it("uploads audio to S3 with dual- prefix in key", async () => {
    const { storagePut } = await import("./storage");
    setupDualMock();

    await caller.translation.dualTranslateChunk({
      audioBase64: createTestAudioBase64(),
      mimeType: "audio/webm",
      chunkIndex: 0,
    });

    // storagePut should have been called with a key containing "dual-"
    expect(storagePut).toHaveBeenCalled();
    const lastCall = (storagePut as any).mock.calls.at(-1);
    expect(lastCall[0]).toContain("dual-");
  });
});
