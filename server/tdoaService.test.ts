/**
 * tdoaService.test.ts — Tests for TDoA triangulation service layer
 *
 * Tests GPS host list fetching, reference transmitters, job submission,
 * progress polling, job management, and result file proxying.
 *
 * Uses vi.mock with factory to properly intercept axios calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock fn that we can control
const mockAxiosGet = vi.fn();

// Mock axios with factory — this gets hoisted above imports
vi.mock("axios", () => ({
  default: {
    get: mockAxiosGet,
  },
}));

// Import after mock setup
import type {
  GpsHost,
  RefTransmitter,
  TdoaSubmitParams,
} from "./tdoaService";

/* ── Test Data ──────────────────────────────────────── */

const mockGpsHosts: GpsHost[] = [
  {
    i: 1,
    id: "KPH",
    h: "kph.kiwisdr.com",
    p: 8073,
    lat: 37.93,
    lon: -122.73,
    lo: -122.73,
    fm: 0,
    u: 2,
    um: 4,
    tc: 12,
    snr: 35,
    v: "1.672",
    mac: "aa:bb:cc:dd:ee:ff",
    a: "KPH Maritime Radio Station",
    n: "KPH",
  },
  {
    i: 2,
    id: "VE3SUN",
    h: "ve3sun.kiwisdr.com",
    p: 8073,
    lat: 43.65,
    lon: -79.38,
    lo: -79.38,
    fm: 0,
    u: 1,
    um: 4,
    tc: 8,
    snr: 28,
    v: "1.670",
    mac: "11:22:33:44:55:66",
    a: "Toronto, Ontario",
    n: "VE3SUN",
  },
  {
    i: 3,
    id: "G8JNJ",
    h: "g8jnj.kiwisdr.com",
    p: 8073,
    lat: 51.47,
    lon: -0.97,
    lo: -0.97,
    fm: 0,
    u: 3,
    um: 8,
    tc: 15,
    snr: 42,
    v: "1.672",
    mac: "ff:ee:dd:cc:bb:aa",
    a: "Berkshire, UK",
    n: "G8JNJ",
  },
];

const mockRefs: RefTransmitter[] = [
  { r: "v", id: "DCF77", t: "DCF77", f: 77.5, p: 200, z: 1, lat: 50.01, lon: 9.0 },
  { r: "t", id: "WWV", t: "WWV", f: 10000, p: 1000, z: 0, lat: 40.68, lon: -105.04 },
  { r: "b", id: "BBC4", t: "BBC Radio 4", f: 198, p: 500, z: 0, lat: 52.37, lon: -1.18 },
];

const mockSubmitParams: TdoaSubmitParams = {
  hosts: [
    { h: "kph.kiwisdr.com", p: 8073, id: "KPH", lat: 37.93, lon: -122.73 },
    { h: "ve3sun.kiwisdr.com", p: 8073, id: "VE3SUN", lat: 43.65, lon: -79.38 },
    { h: "g8jnj.kiwisdr.com", p: 8073, id: "G8JNJ", lat: 51.47, lon: -0.97 },
  ],
  frequencyKhz: 10000,
  passbandHz: 1000,
  sampleTime: 30,
  mapBounds: { north: 60, south: 30, east: 10, west: -130 },
};

/* ── Tests ──────────────────────────────────────────── */

describe("tdoaService", () => {
  // Re-import module fresh for each test to avoid stale in-memory state
  let getGpsHosts: typeof import("./tdoaService").getGpsHosts;
  let getRefTransmitters: typeof import("./tdoaService").getRefTransmitters;
  let submitTdoaJob: typeof import("./tdoaService").submitTdoaJob;
  let pollJobProgress: typeof import("./tdoaService").pollJobProgress;
  let getJob: typeof import("./tdoaService").getJob;
  let getRecentJobs: typeof import("./tdoaService").getRecentJobs;
  let cancelJob: typeof import("./tdoaService").cancelJob;
  let proxyResultFile: typeof import("./tdoaService").proxyResultFile;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic re-import to get fresh module state
    vi.resetModules();
    const mod = await import("./tdoaService");
    getGpsHosts = mod.getGpsHosts;
    getRefTransmitters = mod.getRefTransmitters;
    submitTdoaJob = mod.submitTdoaJob;
    pollJobProgress = mod.pollJobProgress;
    getJob = mod.getJob;
    getRecentJobs = mod.getRecentJobs;
    cancelJob = mod.cancelJob;
    proxyResultFile = mod.proxyResultFile;
  });

  describe("getGpsHosts", () => {
    it("fetches GPS-active KiwiSDR hosts from tdoa.kiwisdr.com", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: mockGpsHosts });

      const hosts = await getGpsHosts();
      expect(hosts).toHaveLength(3);
      expect(hosts[0].id).toBe("KPH");
      expect(hosts[0].h).toBe("kph.kiwisdr.com");
      expect(hosts[0].lat).toBe(37.93);
      expect(hosts[0].lon).toBe(-122.73);
    });

    it("returns cached hosts on subsequent calls within TTL", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: mockGpsHosts });

      const first = await getGpsHosts();
      const second = await getGpsHosts();

      expect(first).toEqual(second);
      // Should only have been called once (second call uses cache)
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    it("host objects have expected GPS fields", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: mockGpsHosts });

      const hosts = await getGpsHosts();
      const host = hosts[0];

      expect(host).toHaveProperty("i");
      expect(host).toHaveProperty("id");
      expect(host).toHaveProperty("h");
      expect(host).toHaveProperty("p");
      expect(host).toHaveProperty("lat");
      expect(host).toHaveProperty("lon");
      expect(host).toHaveProperty("snr");
      expect(host).toHaveProperty("v");
      expect(host).toHaveProperty("a");
      expect(host).toHaveProperty("n");
    });

    it("throws when fetch fails with no cache", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("Network error"));

      await expect(getGpsHosts()).rejects.toThrow("Failed to fetch GPS host list");
    });
  });

  describe("getRefTransmitters", () => {
    it("fetches and parses reference transmitters", async () => {
      // refs.cjson may have comments — simulate clean JSON
      mockAxiosGet.mockResolvedValueOnce({ data: JSON.stringify(mockRefs) });

      const refs = await getRefTransmitters();
      expect(refs).toHaveLength(3);
      expect(refs[0].id).toBe("DCF77");
      expect(refs[1].f).toBe(10000);
      expect(refs[2].r).toBe("b");
    });

    it("ref transmitters have expected fields", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: JSON.stringify(mockRefs) });

      const refs = await getRefTransmitters();
      const ref = refs[0];

      expect(ref).toHaveProperty("r");
      expect(ref).toHaveProperty("id");
      expect(ref).toHaveProperty("f");
      expect(ref).toHaveProperty("p");
      expect(ref).toHaveProperty("lat");
      expect(ref).toHaveProperty("lon");
    });

    it("throws when fetch fails with no cache", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("Network error"));

      await expect(getRefTransmitters()).rejects.toThrow("Failed to fetch reference transmitters");
    });
  });

  describe("submitTdoaJob", () => {
    it("submits a job and returns a job state with ID", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.id).toMatch(/^tdoa-/);
      expect(job.key).toBeTruthy();
      expect(job.status).toBe("sampling");
      expect(job.params).toEqual(mockSubmitParams);
      expect(job.createdAt).toBeGreaterThan(0);
    });

    it("initializes host statuses as 'sampling' for all hosts", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const job = await submitTdoaJob(mockSubmitParams);

      expect(Object.keys(job.hostStatuses)).toHaveLength(3);
      expect(job.hostStatuses["kph.kiwisdr.com"]).toBe("sampling");
      expect(job.hostStatuses["ve3sun.kiwisdr.com"]).toBe("sampling");
      expect(job.hostStatuses["g8jnj.kiwisdr.com"]).toBe("sampling");
    });

    it("sets error status when submission fails", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("Connection refused"));

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.status).toBe("error");
      expect(job.error).toContain("Submit failed");
    });

    it("includes known location in submission when provided", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const paramsWithRef: TdoaSubmitParams = {
        ...mockSubmitParams,
        knownLocation: { lat: 48.86, lon: 2.35, name: "Paris" },
      };

      const job = await submitTdoaJob(paramsWithRef);
      expect(job.params.knownLocation).toEqual({ lat: 48.86, lon: 2.35, name: "Paris" });

      // Verify the pi parameter was included in the request
      const callUrl = mockAxiosGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("known_location");
      expect(callUrl).toContain("Paris");
    });

    it("builds correct query parameters for submission", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      await submitTdoaJob(mockSubmitParams);

      const callUrl = mockAxiosGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("tdoa.kiwisdr.com/php/tdoa.php");
      expect(callUrl).toContain("f=10000");
      expect(callUrl).toContain("s=30");
      expect(callUrl).toContain("w=1000");
      expect(callUrl).toContain("kph.kiwisdr.com");
      expect(callUrl).toContain("ve3sun.kiwisdr.com");
      expect(callUrl).toContain("g8jnj.kiwisdr.com");
    });

    it("includes map bounds in pi parameter", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      await submitTdoaJob(mockSubmitParams);

      const callUrl = mockAxiosGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("lat_range");
      expect(callUrl).toContain("lon_range");
    });
  });

  describe("pollJobProgress", () => {
    it("returns null for non-existent job", async () => {
      const result = await pollJobProgress("nonexistent-job-id");
      expect(result).toBeNull();
    });

    it("returns job state for existing job when progress not ready", async () => {
      // Submit a job first
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // Mock progress.json returning 404 (not ready yet)
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const polled = await pollJobProgress(job.id);
      expect(polled).not.toBeNull();
      expect(polled!.id).toBe(job.id);
      expect(polled!.status).toBe("sampling");
    });

    it("updates status to computing when status0 is present", async () => {
      // Submit a job first
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // Mock progress.json with status0 bitmask (all OK)
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: { status0: 0, done: false },
      });

      const polled = await pollJobProgress(job.id);
      expect(polled!.status).toBe("computing");
    });

    it("fetches results when progress shows done", async () => {
      // Submit a job first
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // Mock progress.json showing done
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: { status0: 0, done: true },
      });

      // Mock status.json with results
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          likely_position: { lat: 40.68, lng: -105.04 },
          input: { per_file: [], result: { status: "OK", message: "Success" } },
        },
      });

      // Mock contour fetches (3 host pairs for 3 hosts: KPH-VE3SUN, KPH-G8JNJ, VE3SUN-G8JNJ)
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const polled = await pollJobProgress(job.id);
      expect(polled!.status).toBe("complete");
      expect(polled!.result?.likely_position).toEqual({ lat: 40.68, lng: -105.04 });
      expect(polled!.completedAt).toBeGreaterThan(0);
    });
  });

  describe("getJob", () => {
    it("returns null for non-existent job", () => {
      const job = getJob("nonexistent");
      expect(job).toBeNull();
    });

    it("returns job for existing job ID", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const submitted = await submitTdoaJob(mockSubmitParams);

      const job = getJob(submitted.id);
      expect(job).not.toBeNull();
      expect(job!.id).toBe(submitted.id);
    });
  });

  describe("getRecentJobs", () => {
    it("returns jobs sorted by creation time (newest first)", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job1 = await submitTdoaJob(mockSubmitParams);

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job2 = await submitTdoaJob(mockSubmitParams);

      const recent = getRecentJobs(10);
      expect(recent.length).toBeGreaterThanOrEqual(2);
      // Newest first
      const idx1 = recent.findIndex((j) => j.id === job1.id);
      const idx2 = recent.findIndex((j) => j.id === job2.id);
      expect(idx2).toBeLessThan(idx1);
    });

    it("respects limit parameter", async () => {
      const recent = getRecentJobs(1);
      expect(recent.length).toBeLessThanOrEqual(1);
    });
  });

  describe("cancelJob", () => {
    it("cancels an active job", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      const cancelled = cancelJob(job.id);
      expect(cancelled).toBe(true);

      const updated = getJob(job.id);
      expect(updated!.status).toBe("error");
      expect(updated!.error).toBe("Cancelled by user");
    });

    it("returns false for non-existent job", () => {
      const cancelled = cancelJob("nonexistent");
      expect(cancelled).toBe(false);
    });

    it("returns false for already cancelled job", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // Cancel it first
      cancelJob(job.id);

      // Try to cancel again — should fail since status is now "error"
      const cancelled = cancelJob(job.id);
      expect(cancelled).toBe(false);
    });
  });

  describe("proxyResultFile", () => {
    it("proxies a result file from tdoa.kiwisdr.com", async () => {
      const mockBuffer = Buffer.from("PNG image data");
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: mockBuffer,
        headers: { "content-type": "image/png" },
      });

      const result = await proxyResultFile("12345", "TDoA_map.png");
      expect(result).not.toBeNull();
      expect(result!.contentType).toBe("image/png");
      expect(result!.data).toEqual(mockBuffer);
    });

    it("returns null for missing files (404)", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const result = await proxyResultFile("12345", "nonexistent.json");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("Network error"));

      const result = await proxyResultFile("12345", "file.json");
      expect(result).toBeNull();
    });
  });
});
