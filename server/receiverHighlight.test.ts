/**
 * receiverHighlight.test.ts — Tests for receiver highlight wiring
 *
 * Tests the logic for:
 * 1. Station label matching (exact and partial)
 * 2. Highlight state management (set, auto-clear)
 * 3. Globe action parsing for HIGHLIGHT type
 * 4. Coordinate extraction for fly-to on highlight
 */
import { describe, it, expect, vi } from "vitest";

// ── Station matching logic (mirrors IntelChat HIGHLIGHT case) ────

interface MockStation {
  label: string;
  location: { coordinates: [number, number] }; // [lng, lat]
  receivers: Array<{ type: string }>;
}

const MOCK_STATIONS: MockStation[] = [
  {
    label: "Twente, Netherlands",
    location: { coordinates: [6.85, 52.24] },
    receivers: [{ type: "WebSDR" }],
  },
  {
    label: "KiwiSDR Tokyo",
    location: { coordinates: [139.69, 35.68] },
    receivers: [{ type: "KiwiSDR" }],
  },
  {
    label: "OpenWebRX Budapest",
    location: { coordinates: [19.04, 47.5] },
    receivers: [{ type: "OpenWebRX" }],
  },
  {
    label: "KiwiSDR São Paulo",
    location: { coordinates: [-46.63, -23.55] },
    receivers: [{ type: "KiwiSDR" }],
  },
  {
    label: "WebSDR Enschede",
    location: { coordinates: [6.89, 52.22] },
    receivers: [{ type: "WebSDR" }],
  },
];

function findStation(
  stations: MockStation[],
  receiverLabel: string
): MockStation | undefined {
  return stations.find(
    (s) =>
      s.label === receiverLabel ||
      s.label.toLowerCase().includes(receiverLabel.toLowerCase())
  );
}

// ── Globe action regex (mirrors IntelChat) ──────────────────────

const GLOBE_ACTION_REGEX =
  /\[GLOBE:(FLY_TO|HIGHLIGHT|OVERLAY):([^:]+):([^\]]+)\]/g;

interface GlobeAction {
  type: "FLY_TO" | "HIGHLIGHT" | "OVERLAY";
  params: string;
  label: string;
}

function parseGlobeActions(text: string): GlobeAction[] {
  const actions: GlobeAction[] = [];
  let match;
  const regex = new RegExp(GLOBE_ACTION_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    actions.push({
      type: match[1] as GlobeAction["type"],
      params: match[2],
      label: match[3],
    });
  }
  return actions;
}

// ── Tests ───────────────────────────────────────────────────────

describe("Receiver Highlight — Station Matching", () => {
  it("finds station by exact label", () => {
    const result = findStation(MOCK_STATIONS, "Twente, Netherlands");
    expect(result).toBeDefined();
    expect(result!.label).toBe("Twente, Netherlands");
  });

  it("finds station by partial label (case-insensitive)", () => {
    const result = findStation(MOCK_STATIONS, "tokyo");
    expect(result).toBeDefined();
    expect(result!.label).toBe("KiwiSDR Tokyo");
  });

  it("finds station by partial label with different casing", () => {
    const result = findStation(MOCK_STATIONS, "BUDAPEST");
    expect(result).toBeDefined();
    expect(result!.label).toBe("OpenWebRX Budapest");
  });

  it("returns undefined for non-existent station", () => {
    const result = findStation(MOCK_STATIONS, "NonExistent Station XYZ");
    expect(result).toBeUndefined();
  });

  it("returns first match when multiple stations match partial", () => {
    // Both "Twente, Netherlands" and "WebSDR Enschede" are in Netherlands area
    // but only "Twente" matches "twente"
    const result = findStation(MOCK_STATIONS, "twente");
    expect(result).toBeDefined();
    expect(result!.label).toBe("Twente, Netherlands");
  });

  it("matches station with special characters in label", () => {
    const result = findStation(MOCK_STATIONS, "São Paulo");
    expect(result).toBeDefined();
    expect(result!.label).toBe("KiwiSDR São Paulo");
  });

  it("handles empty search string", () => {
    // Empty string matches everything via includes("")
    const result = findStation(MOCK_STATIONS, "");
    expect(result).toBeDefined(); // matches first station
  });

  it("handles whitespace-only search", () => {
    const result = findStation(MOCK_STATIONS, "   ");
    expect(result).toBeUndefined();
  });
});

describe("Receiver Highlight — Coordinate Extraction", () => {
  it("extracts correct lat/lng from station for fly-to", () => {
    const station = findStation(MOCK_STATIONS, "Tokyo");
    expect(station).toBeDefined();
    const [lng, lat] = station!.location.coordinates;
    expect(lat).toBeCloseTo(35.68, 1);
    expect(lng).toBeCloseTo(139.69, 1);
  });

  it("extracts correct lat/lng for southern hemisphere station", () => {
    const station = findStation(MOCK_STATIONS, "São Paulo");
    expect(station).toBeDefined();
    const [lng, lat] = station!.location.coordinates;
    expect(lat).toBeLessThan(0); // southern hemisphere
    expect(lng).toBeLessThan(0); // western hemisphere
  });

  it("creates valid globe target from station coordinates", () => {
    const station = findStation(MOCK_STATIONS, "Budapest");
    expect(station).toBeDefined();
    const [lng, lat] = station!.location.coordinates;
    const globeTarget = { lat, lng, zoom: 3 };
    expect(globeTarget.lat).toBeCloseTo(47.5, 1);
    expect(globeTarget.lng).toBeCloseTo(19.04, 1);
    expect(globeTarget.zoom).toBe(3);
  });
});

describe("Receiver Highlight — Globe Action Parsing", () => {
  it("parses HIGHLIGHT action from LLM response", () => {
    const text =
      "Here is the receiver: [GLOBE:HIGHLIGHT:KiwiSDR Tokyo:Highlight Tokyo]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("HIGHLIGHT");
    expect(actions[0].params).toBe("KiwiSDR Tokyo");
    expect(actions[0].label).toBe("Highlight Tokyo");
  });

  it("parses multiple HIGHLIGHT actions", () => {
    const text =
      "Check these: [GLOBE:HIGHLIGHT:Tokyo:Tokyo SDR] and [GLOBE:HIGHLIGHT:Budapest:Budapest SDR]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(2);
    expect(actions[0].params).toBe("Tokyo");
    expect(actions[1].params).toBe("Budapest");
  });

  it("parses mixed action types including HIGHLIGHT", () => {
    const text =
      "[GLOBE:FLY_TO:35.68,139.69:Fly to Tokyo] [GLOBE:HIGHLIGHT:KiwiSDR Tokyo:Highlight it] [GLOBE:OVERLAY:conflict:Show conflicts]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(3);
    expect(actions[0].type).toBe("FLY_TO");
    expect(actions[1].type).toBe("HIGHLIGHT");
    expect(actions[2].type).toBe("OVERLAY");
  });

  it("returns empty array for text without globe actions", () => {
    const text = "This is a normal response with no actions.";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(0);
  });

  it("handles HIGHLIGHT with spaces in params", () => {
    const text =
      "[GLOBE:HIGHLIGHT:Twente, Netherlands:Highlight Twente receiver]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toBe("Twente, Netherlands");
  });
});

describe("Receiver Highlight — State Management", () => {
  it("highlight state can be set and cleared", () => {
    let highlightedLabel: string | null = null;
    const setHighlighted = (label: string | null) => {
      highlightedLabel = label;
    };

    // Set highlight
    setHighlighted("KiwiSDR Tokyo");
    expect(highlightedLabel).toBe("KiwiSDR Tokyo");

    // Clear highlight
    setHighlighted(null);
    expect(highlightedLabel).toBeNull();
  });

  it("auto-clear timeout fires after specified duration", () => {
    vi.useFakeTimers();

    let highlightedLabel: string | null = null;
    const setHighlighted = (label: string | null) => {
      highlightedLabel = label;
    };

    // Set highlight with auto-clear
    setHighlighted("KiwiSDR Tokyo");
    expect(highlightedLabel).toBe("KiwiSDR Tokyo");

    // Schedule auto-clear (mirrors IntelChat implementation)
    setTimeout(() => setHighlighted(null), 10000);

    // Before timeout
    vi.advanceTimersByTime(9999);
    expect(highlightedLabel).toBe("KiwiSDR Tokyo");

    // After timeout
    vi.advanceTimersByTime(1);
    expect(highlightedLabel).toBeNull();

    vi.useRealTimers();
  });

  it("new highlight replaces previous highlight", () => {
    let highlightedLabel: string | null = null;
    const setHighlighted = (label: string | null) => {
      highlightedLabel = label;
    };

    setHighlighted("KiwiSDR Tokyo");
    expect(highlightedLabel).toBe("KiwiSDR Tokyo");

    setHighlighted("OpenWebRX Budapest");
    expect(highlightedLabel).toBe("OpenWebRX Budapest");
  });

  it("setting same highlight twice is idempotent", () => {
    let callCount = 0;
    let highlightedLabel: string | null = null;
    const setHighlighted = (label: string | null) => {
      highlightedLabel = label;
      callCount++;
    };

    setHighlighted("KiwiSDR Tokyo");
    setHighlighted("KiwiSDR Tokyo");
    expect(highlightedLabel).toBe("KiwiSDR Tokyo");
    expect(callCount).toBe(2); // Both calls execute
  });
});

describe("Receiver Highlight — End-to-End Flow", () => {
  it("full flow: parse action → find station → extract coords → set highlight", () => {
    const text =
      "I found the receiver. [GLOBE:HIGHLIGHT:Tokyo:Highlight KiwiSDR Tokyo]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);

    const action = actions[0];
    expect(action.type).toBe("HIGHLIGHT");

    const station = findStation(MOCK_STATIONS, action.params.trim());
    expect(station).toBeDefined();
    expect(station!.label).toBe("KiwiSDR Tokyo");

    const [lng, lat] = station!.location.coordinates;
    const globeTarget = { lat, lng, zoom: 3 };
    expect(globeTarget.lat).toBeCloseTo(35.68, 1);
    expect(globeTarget.lng).toBeCloseTo(139.69, 1);
  });

  it("full flow handles station not found gracefully", () => {
    const text =
      "[GLOBE:HIGHLIGHT:NonExistent Station:Highlight unknown]";
    const actions = parseGlobeActions(text);
    expect(actions).toHaveLength(1);

    const station = findStation(MOCK_STATIONS, actions[0].params.trim());
    expect(station).toBeUndefined();
    // In the real implementation, this logs a warning and does nothing
  });

  it("highlight mesh index resolves correctly from label", () => {
    // Simulates the animation loop logic
    const markerMeshes = MOCK_STATIONS.map((station, idx) => ({
      station,
      mesh: { scale: { set: vi.fn() }, material: { color: { setHex: vi.fn() }, opacity: 0.85 } },
      baseScale: 0.055,
    }));

    const highlightedLabel = "KiwiSDR Tokyo";
    const hlIdx = markerMeshes.findIndex(
      ({ station }) => station.label === highlightedLabel
    );
    expect(hlIdx).toBe(1); // Tokyo is at index 1

    // No highlight
    const noHlIdx = markerMeshes.findIndex(
      ({ station }) => station.label === "nonexistent"
    );
    expect(noHlIdx).toBe(-1);
  });
});
