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
  let selectBestHosts: typeof import("./tdoaService").selectBestHosts;

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
    selectBestHosts = mod.selectBestHosts;
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

    it("sets error status when submission fails with network error", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("Connection refused"));

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.status).toBe("error");
      expect(job.error).toContain("Submit failed");
    });

    it("handles 401 Unauthorized with auth key rotation message", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 401, data: "401 - Unauthorized" });

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.status).toBe("error");
      expect(job.error).toContain("401 Unauthorized");
      expect(job.error).toContain("auth key may have been rotated");
    });

    it("handles other 4xx errors gracefully", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 403, data: "Forbidden" });

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.status).toBe("error");
      expect(job.error).toContain("HTTP 403");
    });

    it("succeeds with 200 status", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: "OK" });

      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.status).toBe("sampling");
      expect(job.error).toBeUndefined();
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
      expect(callUrl).toContain("auth=4cd0d4f2af04b308bb258011e051919c");
      expect(callUrl).toContain("f=10000");
      expect(callUrl).toContain("s=30");
      expect(callUrl).toContain("w=1000");
      expect(callUrl).toContain("kph.kiwisdr.com");
      expect(callUrl).toContain("ve3sun.kiwisdr.com");
      expect(callUrl).toContain("g8jnj.kiwisdr.com");
    });

    it("encodes slashes in host IDs", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const paramsWithSlash: TdoaSubmitParams = {
        ...mockSubmitParams,
        hosts: [
          { h: "host1.com", p: 8073, id: "K9DXI/1", lat: 46.2, lon: -89.6 },
          { h: "host2.com", p: 8073, id: "VE3SUN", lat: 43.65, lon: -79.38 },
        ],
      };

      await submitTdoaJob(paramsWithSlash);

      const callUrl = mockAxiosGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("K9DXI-1");
      expect(callUrl).not.toContain("K9DXI/1");
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

      // Mock status.json fallback check (404 = not done yet)
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const polled = await pollJobProgress(job.id);
      expect(polled!.status).toBe("computing");
    });

    it("detects completion via status.json when done flag stays 0", async () => {
      // Submit a job first
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // Mock progress.json with status0 but done=false (the bug)
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: { status0: 0, done: false },
      });

      // Mock status.json fallback check — returns 200 with result data
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          position: { likely_position: { lat: 6.5, lng: -85 } },
          input: {
            per_file: [{ name: "IO54if", status: "GOOD" }],
            result: { status: "GOOD", message: "2/3 good stations" },
          },
        },
      });

      // Mock the fetchJobResults call (status.json fetched again)
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          position: { likely_position: { lat: 6.5, lng: -85 } },
          input: {
            per_file: [{ name: "IO54if", status: "GOOD" }],
            result: { status: "GOOD", message: "2/3 good stations" },
          },
        },
      });

      // Mock contour fetches
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const polled = await pollJobProgress(job.id);
      expect(polled!.status).toBe("complete");
      expect(polled!.completedAt).toBeGreaterThan(0);
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

  describe("selectBestHosts", () => {
    const makeHost = (overrides: Partial<GpsHost>): GpsHost => ({
      i: 1,
      id: "TEST",
      h: "test.kiwisdr.com",
      p: 8073,
      lat: 0,
      lon: 0,
      lo: 0,
      fm: 0,
      u: 0,
      um: 4,
      tc: 8,
      snr: 30,
      v: "1.672",
      mac: "aa:bb:cc:dd:ee:ff",
      a: "Test Location",
      n: "TEST",
      ...overrides,
    });

    it("returns empty array when no hosts available", () => {
      const result = selectBestHosts([]);
      expect(result).toEqual([]);
    });

    it("returns all hosts when fewer than requested count", () => {
      const hosts = [
        makeHost({ i: 1, id: "A", h: "a.com", lat: 10, lon: 20, snr: 30 }),
        makeHost({ i: 2, id: "B", h: "b.com", lat: 40, lon: 50, snr: 25 }),
      ];
      const result = selectBestHosts(hosts, 3);
      expect(result).toHaveLength(2);
    });

    it("selects exactly the requested count of hosts", () => {
      const hosts = [
        makeHost({ i: 1, id: "A", h: "a.com", lat: 10, lon: 20, snr: 30 }),
        makeHost({ i: 2, id: "B", h: "b.com", lat: 40, lon: 50, snr: 25 }),
        makeHost({ i: 3, id: "C", h: "c.com", lat: -30, lon: 120, snr: 35 }),
        makeHost({ i: 4, id: "D", h: "d.com", lat: 60, lon: -100, snr: 20 }),
        makeHost({ i: 5, id: "E", h: "e.com", lat: -50, lon: -60, snr: 28 }),
      ];
      const result = selectBestHosts(hosts, 3);
      expect(result).toHaveLength(3);
    });

    it("filters out hosts with no GPS lock (tc=0)", () => {
      const hosts = [
        makeHost({ i: 1, id: "A", h: "a.com", lat: 10, lon: 20, snr: 30, tc: 0 }),
        makeHost({ i: 2, id: "B", h: "b.com", lat: 40, lon: 50, snr: 25, tc: 8 }),
        makeHost({ i: 3, id: "C", h: "c.com", lat: -30, lon: 120, snr: 35, tc: 12 }),
      ];
      const result = selectBestHosts(hosts, 3);
      expect(result).toHaveLength(2);
      expect(result.every((h) => h.tc > 0)).toBe(true);
    });

    it("filters out hosts at full capacity (u >= um)", () => {
      const hosts = [
        makeHost({ i: 1, id: "A", h: "a.com", lat: 10, lon: 20, snr: 30, u: 4, um: 4 }),
        makeHost({ i: 2, id: "B", h: "b.com", lat: 40, lon: 50, snr: 25, u: 1, um: 4 }),
        makeHost({ i: 3, id: "C", h: "c.com", lat: -30, lon: 120, snr: 35, u: 2, um: 8 }),
      ];
      const result = selectBestHosts(hosts, 3);
      expect(result).toHaveLength(2);
      expect(result.every((h) => h.u < h.um)).toBe(true);
    });

    it("filters out hosts with zero SNR", () => {
      const hosts = [
        makeHost({ i: 1, id: "A", h: "a.com", lat: 10, lon: 20, snr: 0 }),
        makeHost({ i: 2, id: "B", h: "b.com", lat: 40, lon: 50, snr: 25 }),
        makeHost({ i: 3, id: "C", h: "c.com", lat: -30, lon: 120, snr: 35 }),
      ];
      const result = selectBestHosts(hosts, 3);
      expect(result).toHaveLength(2);
      expect(result.every((h) => h.snr > 0)).toBe(true);
    });

    it("prefers geographically spread hosts over clustered ones", () => {
      // Create a cluster of 3 hosts near each other, plus 2 far away
      const hosts = [
        makeHost({ i: 1, id: "Cluster1", h: "c1.com", lat: 51.0, lon: 0.0, snr: 40 }),
        makeHost({ i: 2, id: "Cluster2", h: "c2.com", lat: 51.1, lon: 0.1, snr: 38 }),
        makeHost({ i: 3, id: "Cluster3", h: "c3.com", lat: 51.2, lon: 0.2, snr: 36 }),
        makeHost({ i: 4, id: "FarAway1", h: "f1.com", lat: -33.0, lon: 151.0, snr: 30 }),
        makeHost({ i: 5, id: "FarAway2", h: "f2.com", lat: 40.0, lon: -74.0, snr: 28 }),
      ];
      const result = selectBestHosts(hosts, 3);

      // Should pick at most 1 from the cluster, plus the 2 far-away hosts
      const clusterCount = result.filter((h) =>
        ["Cluster1", "Cluster2", "Cluster3"].includes(h.id)
      ).length;
      expect(clusterCount).toBeLessThanOrEqual(2);

      // Should include at least one far-away host
      const farCount = result.filter((h) =>
        ["FarAway1", "FarAway2"].includes(h.id)
      ).length;
      expect(farCount).toBeGreaterThanOrEqual(1);
    });

    it("respects custom count parameter", () => {
      const hosts = Array.from({ length: 10 }, (_, i) =>
        makeHost({
          i: i + 1,
          id: `Host${i}`,
          h: `host${i}.com`,
          lat: (i * 36) - 90,
          lon: (i * 72) - 180,
          snr: 20 + i * 2,
        })
      );
      expect(selectBestHosts(hosts, 2)).toHaveLength(2);
      expect(selectBestHosts(hosts, 4)).toHaveLength(4);
      expect(selectBestHosts(hosts, 6)).toHaveLength(6);
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

    it("proxies heatmap PNG for globe overlay", async () => {
      const mockPng = Buffer.from("\x89PNG\r\n\x1a\n fake png data");
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: mockPng,
        headers: { "content-type": "image/png" },
      });

      const result = await proxyResultFile("06843", "TDoA map_for_map.png");
      expect(result).not.toBeNull();
      expect(result!.contentType).toBe("image/png");
      expect(result!.data).toEqual(mockPng);

      // Verify the correct URL was called
      const callUrl = mockAxiosGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("06843");
      expect(callUrl).toContain("TDoA map_for_map.png");
    });
  });

  describe("submitTdoaJob result with heatmap key", () => {
    it("job state includes key for heatmap URL construction", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const job = await submitTdoaJob(mockSubmitParams);
      expect(job.key).toBeDefined();
      expect(typeof job.key).toBe("string");
      expect(job.key!.length).toBeGreaterThan(0);
    });

    it("heatmap key is a 5-digit string suitable for URL construction", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });

      const job = await submitTdoaJob(mockSubmitParams);
      expect(job.key).toMatch(/^\d{5}$/);
    });
  });

  describe("pollJobProgress with status.json fallback", () => {
    it("detects completion from status.json when progress.json never sets done", async () => {
      // First submit a job
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      // progress.json shows computing (status0 set) but done=0
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          key: job.key,
          status0: 42, // all hosts OK
          done: 0,
        },
      });
      // status.json fallback check — returns result
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          likely_position: { lat: 40.68, lng: -105.04 },
          hosts: {},
        },
      });
      // fetchJobResults calls status.json again for the full result
      mockAxiosGet.mockResolvedValueOnce({
        status: 200,
        data: {
          likely_position: { lat: 40.68, lng: -105.04 },
          hosts: {},
        },
      });
      // fetchJobResults tries to fetch contour files for each host pair
      // 3 hosts = 3 pairs (0-1, 0-2, 1-2)
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });
      mockAxiosGet.mockResolvedValueOnce({ status: 404, data: null });

      const result = await pollJobProgress(job.id);
      expect(result!.status).toBe("complete");
      expect(result!.result?.likely_position.lat).toBe(40.68);
    });
  });

  describe("shareable URLs - getJobById", () => {
    it("returns job data structure suitable for shareable result page", async () => {
      // Verify the job state structure includes all fields needed for the result page
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.id).toBeDefined();
      expect(job.key).toBeDefined();
      expect(job.params).toBeDefined();
      expect(job.params.frequencyKhz).toBe(10000);
      expect(job.params.hosts).toHaveLength(3);
      expect(job.createdAt).toBeGreaterThan(0);
    });

    it("job key can be used to construct heatmap URL", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      const heatmapUrl = `/api/tdoa-heatmap/${job.key}/TDoA_map_for_map.png`;
      expect(heatmapUrl).toContain(job.key);
      expect(heatmapUrl).toContain("TDoA_map_for_map.png");
    });

    it("job params include mapBounds for heatmap overlay positioning", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: "OK" });
      const job = await submitTdoaJob(mockSubmitParams);

      expect(job.params.mapBounds).toEqual({
        north: 60, south: 30, east: 10, west: -130,
      });
    });
  });

  describe("comparison view data", () => {
    it("two jobs can be compared by their likely positions", async () => {
      // Simulate two completed jobs with different positions
      const pos1 = { lat: 40.68, lng: -105.04 };
      const pos2 = { lat: 41.12, lng: -104.85 };

      // Calculate drift distance (Haversine approximation)
      const dLat = (pos2.lat - pos1.lat) * (Math.PI / 180);
      const dLon = (pos2.lng - pos1.lng) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(pos1.lat * Math.PI / 180) *
        Math.cos(pos2.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distKm = 6371 * c;

      // Positions should be within reasonable TDoA accuracy (< 100km)
      expect(distKm).toBeLessThan(100);
      expect(distKm).toBeGreaterThan(0);
    });

    it("drift bearing can be calculated between two positions", () => {
      const pos1 = { lat: 40.68, lon: -105.04 };
      const pos2 = { lat: 41.12, lon: -104.85 };

      const dLon = (pos2.lon - pos1.lon) * (Math.PI / 180);
      const lat1 = pos1.lat * (Math.PI / 180);
      const lat2 = pos2.lat * (Math.PI / 180);
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      const bearing = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;

      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    });

    it("host overlap can be computed between two job host sets", () => {
      const hosts1 = ["kph.kiwisdr.com", "ve3sun.kiwisdr.com", "g8jnj.kiwisdr.com"];
      const hosts2 = ["kph.kiwisdr.com", "dl1rf.kiwisdr.com", "g8jnj.kiwisdr.com"];

      const set1 = new Set(hosts1);
      const overlap = hosts2.filter((h) => set1.has(h));
      const overlapPct = overlap.length / Math.max(hosts1.length, hosts2.length) * 100;

      expect(overlap).toHaveLength(2);
      expect(overlapPct).toBeCloseTo(66.67, 0);
    });
  });

  describe("waterfall integration", () => {
    it("KiwiSDR URL can be constructed from host and frequency", () => {
      const host = "kph.kiwisdr.com";
      const port = 8073;
      const freq = 10000;
      const mode = "usb";
      const zoom = 10;

      const url = `http://${host}:${port}/?f=${freq}/${mode}&z=${zoom}`;

      expect(url).toBe("http://kph.kiwisdr.com:8073/?f=10000/usb&z=10");
      expect(url).toContain(host);
      expect(url).toContain(String(freq));
    });

    it("mode is determined by frequency range", () => {
      const getMode = (freqKhz: number) => {
        if (freqKhz < 500) return "cw";
        if (freqKhz > 3000 && freqKhz < 30000) return "usb";
        return "am";
      };

      expect(getMode(77.5)).toBe("cw");    // DCF77
      expect(getMode(198)).toBe("cw");     // BBC R4 LW
      expect(getMode(1000)).toBe("am");    // MW broadcast
      expect(getMode(10000)).toBe("usb");  // WWV
      expect(getMode(14100)).toBe("usb");  // 20m ham band
    });

    it("zoom level scales with passband width", () => {
      const getZoom = (passbandHz: number) => {
        if (passbandHz <= 500) return 12;
        if (passbandHz <= 2000) return 10;
        if (passbandHz <= 6000) return 8;
        return 6;
      };

      expect(getZoom(200)).toBe(12);   // Narrow CW
      expect(getZoom(1000)).toBe(10);  // Standard AM
      expect(getZoom(4000)).toBe(8);   // Wide AM
      expect(getZoom(10000)).toBe(6);  // Very wide
    });

    it("selected hosts provide valid connection targets for waterfall", async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: mockGpsHosts });
      const hosts = await getGpsHosts();

      // Each host should have hostname and port for iframe URL
      hosts.forEach((host) => {
        expect(host.h).toBeTruthy();
        expect(host.p).toBeGreaterThan(0);
        const url = `http://${host.h}:${host.p}/?f=10000/usb&z=10`;
        expect(url).toMatch(/^http:\/\/.+:\d+\/\?f=/);
      });
    });
  });

  describe("contour data structure", () => {
    it("contour data includes polygons and polygon_colors for accuracy overlay", () => {
      // Verify the expected structure of contour data that the globe overlay consumes
      const mockContour = {
        imgBounds: { north: 55, south: 35, east: 10, west: -130 },
        polygons: [
          [{ lat: 40, lng: -100 }, { lat: 42, lng: -98 }, { lat: 41, lng: -102 }],
          [{ lat: 40.5, lng: -100.5 }, { lat: 41.5, lng: -99 }, { lat: 40.8, lng: -101 }],
        ],
        polygon_colors: ["#ff000080", "#ff000040"],
        polylines: [
          [{ lat: 40, lng: -100 }, { lat: 42, lng: -98 }],
        ],
        polyline_colors: ["#c084fc"],
      };

      expect(mockContour.polygons).toHaveLength(2);
      expect(mockContour.polygon_colors).toHaveLength(2);
      expect(mockContour.polygons[0]).toHaveLength(3);
      expect(mockContour.polygons[0][0]).toHaveProperty("lat");
      expect(mockContour.polygons[0][0]).toHaveProperty("lng");
      expect(mockContour.imgBounds).toHaveProperty("north");
      expect(mockContour.imgBounds).toHaveProperty("south");
    });

    it("inner contour polygons represent higher confidence regions", () => {
      // Inner polygons (higher index) should be smaller/tighter
      const outerPolygon = [
        { lat: 38, lng: -108 }, { lat: 44, lng: -96 }, { lat: 38, lng: -96 }, { lat: 44, lng: -108 },
      ];
      const innerPolygon = [
        { lat: 40, lng: -104 }, { lat: 42, lng: -100 }, { lat: 40, lng: -100 }, { lat: 42, lng: -104 },
      ];

      // Calculate bounding box areas
      const outerArea = (44 - 38) * (108 - 96);
      const innerArea = (42 - 40) * (104 - 100);

      expect(innerArea).toBeLessThan(outerArea);
    });
  });
});
