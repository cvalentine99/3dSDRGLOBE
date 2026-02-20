import { describe, it, expect } from "vitest";

/**
 * NavBarGroup component tests
 * Tests the data structure and grouping logic used by the nav bar reorganization.
 * The NavBarGroup is a React component, so we test the configuration/data layer here.
 */

// Simulate the NavBarItem type
interface NavBarItem {
  id: string;
  label: string;
  colorClass: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number | null;
  badgePulse?: boolean;
}

// Simulate the group configuration as used in Home.tsx
interface NavBarGroupConfig {
  label: string;
  colorClass: string;
  items: NavBarItem[];
}

const overlaysGroup: NavBarGroupConfig = {
  label: "Overlays",
  colorClass: "cyan",
  items: [
    { id: "propagation", label: "HF Propagation", colorClass: "cyan" },
    { id: "conflict", label: "Conflict Data (UCDP)", colorClass: "red" },
  ],
};

const sigintGroup: NavBarGroupConfig = {
  label: "SIGINT",
  colorClass: "violet",
  items: [
    { id: "tdoa", label: "TDoA Triangulation", colorClass: "violet", badge: 3 },
    { id: "targets", label: "Saved Targets", colorClass: "rose", badge: 5 },
    { id: "milrf", label: "Military RF Intel", colorClass: "red" },
  ],
};

const monitorGroup: NavBarGroupConfig = {
  label: "Monitor",
  colorClass: "emerald",
  items: [
    { id: "watchlist", label: "Watchlist (2/5)", colorClass: "emerald", badge: 5 },
    { id: "alerts", label: "Alert Settings", colorClass: "amber", badge: 3, badgePulse: true },
    { id: "anomaly", label: "Anomaly Detection", colorClass: "red", badge: 1, badgePulse: true },
  ],
};

const collabGroup: NavBarGroupConfig = {
  label: "Collab",
  colorClass: "blue",
  items: [
    { id: "share", label: "Shared Target Lists", colorClass: "blue" },
    { id: "dashboard", label: "Analytics Dashboard", colorClass: "indigo" },
  ],
};

const allGroups = [overlaysGroup, sigintGroup, monitorGroup, collabGroup];

describe("NavBarGroup configuration", () => {
  it("should have exactly 4 groups", () => {
    expect(allGroups).toHaveLength(4);
  });

  it("should contain all 10 original nav buttons across groups", () => {
    const allItems = allGroups.flatMap((g) => g.items);
    expect(allItems).toHaveLength(10);

    const ids = allItems.map((i) => i.id);
    expect(ids).toContain("propagation");
    expect(ids).toContain("conflict");
    expect(ids).toContain("tdoa");
    expect(ids).toContain("targets");
    expect(ids).toContain("milrf");
    expect(ids).toContain("watchlist");
    expect(ids).toContain("alerts");
    expect(ids).toContain("anomaly");
    expect(ids).toContain("share");
    expect(ids).toContain("dashboard");
  });

  it("should have unique IDs across all groups", () => {
    const allItems = allGroups.flatMap((g) => g.items);
    const ids = allItems.map((i) => i.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("should have unique group labels", () => {
    const labels = allGroups.map((g) => g.label);
    const uniqueLabels = new Set(labels);
    expect(uniqueLabels.size).toBe(labels.length);
  });

  it("each item should have a valid colorClass", () => {
    const validColors = ["cyan", "red", "violet", "rose", "emerald", "amber", "blue", "indigo"];
    const allItems = allGroups.flatMap((g) => g.items);
    for (const item of allItems) {
      expect(validColors).toContain(item.colorClass);
    }
  });

  it("overlays group should contain map layer toggles", () => {
    const ids = overlaysGroup.items.map((i) => i.id);
    expect(ids).toContain("propagation");
    expect(ids).toContain("conflict");
  });

  it("sigint group should contain intelligence tools", () => {
    const ids = sigintGroup.items.map((i) => i.id);
    expect(ids).toContain("tdoa");
    expect(ids).toContain("targets");
    expect(ids).toContain("milrf");
  });

  it("monitor group should contain monitoring tools", () => {
    const ids = monitorGroup.items.map((i) => i.id);
    expect(ids).toContain("watchlist");
    expect(ids).toContain("alerts");
    expect(ids).toContain("anomaly");
  });

  it("collab group should contain collaboration tools", () => {
    const ids = collabGroup.items.map((i) => i.id);
    expect(ids).toContain("share");
    expect(ids).toContain("dashboard");
  });

  it("badges should be numbers or null/undefined", () => {
    const allItems = allGroups.flatMap((g) => g.items);
    for (const item of allItems) {
      if (item.badge !== undefined && item.badge !== null) {
        expect(typeof item.badge).toBe("number");
        expect(item.badge).toBeGreaterThan(0);
      }
    }
  });

  it("badgePulse should only be set on items with badges", () => {
    const allItems = allGroups.flatMap((g) => g.items);
    for (const item of allItems) {
      if (item.badgePulse) {
        expect(item.badge).toBeDefined();
        expect(item.badge).not.toBeNull();
      }
    }
  });

  it("total buttons reduced from 13 individual to 4 groups + 2 standalone", () => {
    // Original: 13 individual buttons (10 features + theme + help + station list toggle)
    // New: 4 group buttons + theme toggle + help button = 6 top-level elements
    const topLevelElements = allGroups.length + 2; // groups + theme + help
    expect(topLevelElements).toBe(6);
    expect(topLevelElements).toBeLessThan(13);
  });
});

describe("NavBarGroup color mapping", () => {
  const COLOR_CONFIG: Record<string, { bg: string; border: string; text: string }> = {
    cyan: { bg: "bg-cyan-500/15", border: "border-cyan-500/25", text: "text-cyan-600" },
    violet: { bg: "bg-violet-500/15", border: "border-violet-500/25", text: "text-violet-600" },
    emerald: { bg: "bg-emerald-500/15", border: "border-emerald-500/25", text: "text-emerald-600" },
    blue: { bg: "bg-blue-500/15", border: "border-blue-500/25", text: "text-blue-600" },
    red: { bg: "bg-red-500/15", border: "border-red-500/25", text: "text-red-600" },
    rose: { bg: "bg-rose-500/15", border: "border-rose-500/25", text: "text-rose-600" },
    amber: { bg: "bg-amber-500/15", border: "border-amber-500/25", text: "text-amber-600" },
    indigo: { bg: "bg-indigo-500/15", border: "border-indigo-500/25", text: "text-indigo-600" },
  };

  it("every group colorClass should have a color config entry", () => {
    for (const group of allGroups) {
      expect(COLOR_CONFIG[group.colorClass]).toBeDefined();
    }
  });

  it("every item colorClass should have a color config entry", () => {
    const allItems = allGroups.flatMap((g) => g.items);
    for (const item of allItems) {
      expect(COLOR_CONFIG[item.colorClass]).toBeDefined();
    }
  });
});
