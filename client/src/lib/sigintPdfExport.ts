/**
 * sigintPdfExport.ts — SIGINT × Conflict Timeline PDF Report Generator
 *
 * Generates a formatted PDF intelligence briefing from the SIGINT × Conflict
 * timeline data, including:
 * - Executive summary with key metrics
 * - Correlation analysis table
 * - Signal anomaly breakdown
 * - Conflict event summary by country/type
 * - Timeline chart (text-based representation)
 *
 * Uses jsPDF for client-side PDF generation.
 */

import { jsPDF } from "jspdf";

/* ── Types ──────────────────────────────────────────────────── */

interface TimelineEntry {
  id: string;
  timestamp: string;
  type: "signal" | "conflict";
  stationLabel?: string;
  snr?: number;
  online?: boolean;
  adcOverload?: boolean;
  users?: number;
  signalEventType?: "snr_drop" | "snr_spike" | "offline" | "adc_overload" | "normal";
  conflictEvent?: {
    id: number;
    date: string;
    lat: number;
    lng: number;
    country: string;
    conflict: string;
    type: number;
    best: number;
    region?: string;
    sideA?: string;
    sideB?: string;
  };
  lat?: number;
  lon?: number;
}

interface CorrelationMatch {
  signalEntry: TimelineEntry;
  conflictEntry: TimelineEntry;
  timeDeltaHours: number;
  score: number;
  reason: string;
}

interface PdfExportData {
  timeline: TimelineEntry[];
  correlations: CorrelationMatch[];
  timeFilter: string;
  selectedStation: string | null;
}

/* ── Constants ──────────────────────────────────────────────── */

const COLORS = {
  primary: [20, 184, 166] as [number, number, number],     // teal
  danger: [239, 68, 68] as [number, number, number],       // red
  warning: [245, 158, 11] as [number, number, number],     // amber
  info: [6, 182, 212] as [number, number, number],         // cyan
  muted: [100, 116, 139] as [number, number, number],      // slate
  dark: [15, 23, 42] as [number, number, number],          // slate-900
  white: [255, 255, 255] as [number, number, number],
  lightBg: [241, 245, 249] as [number, number, number],    // slate-100
  headerBg: [30, 41, 59] as [number, number, number],      // slate-800
};

const VIOLENCE_LABELS: Record<number, string> = {
  1: "State-based",
  2: "Non-state",
  3: "One-sided",
};

const SIGNAL_EVENT_LABELS: Record<string, string> = {
  snr_drop: "SNR Drop",
  snr_spike: "SNR Spike",
  offline: "Station Offline",
  adc_overload: "ADC Overload",
  normal: "Normal",
};

/* ── Helper Functions ──────────────────────────────────────── */

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

/* ── PDF Generation ────────────────────────────────────────── */

export function generateSigintPdfReport(data: PdfExportData): void {
  const { timeline, correlations, timeFilter, selectedStation } = data;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Page management ─────────────────────────────────────
  function checkPageBreak(needed: number): void {
    if (y + needed > pageHeight - 20) {
      addFooter();
      doc.addPage();
      y = margin;
      addPageHeader();
    }
  }

  function addFooter(): void {
    const pageNum = doc.getNumberOfPages();
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `SIGINT × Conflict Intelligence Report — Page ${pageNum}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" }
    );
    doc.text(
      `Generated: ${new Date().toISOString()} | CLASSIFICATION: UNCLASSIFIED`,
      pageWidth / 2,
      pageHeight - 4,
      { align: "center" }
    );
  }

  function addPageHeader(): void {
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text("SIGINT × CONFLICT CORRELATION REPORT", margin, y);
    doc.text(
      `Valentine RF — ${new Date().toLocaleDateString()}`,
      pageWidth - margin,
      y,
      { align: "right" }
    );
    y += 6;
    doc.setDrawColor(...COLORS.muted);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
  }

  // ── Section helpers ─────────────────────────────────────
  function sectionTitle(title: string, color: [number, number, number] = COLORS.primary): void {
    checkPageBreak(12);
    doc.setFillColor(...color);
    doc.rect(margin, y, 3, 6, "F");
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.dark);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin + 5, y + 4.5);
    y += 10;
    doc.setFont("helvetica", "normal");
  }

  function metricBox(
    x: number,
    label: string,
    value: string,
    color: [number, number, number]
  ): void {
    const boxW = (contentWidth - 6) / 4;
    doc.setFillColor(245, 248, 252);
    doc.roundedRect(x, y, boxW, 18, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.muted);
    doc.text(label, x + boxW / 2, y + 5, { align: "center" });
    doc.setFontSize(14);
    doc.setTextColor(...color);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + boxW / 2, y + 14, { align: "center" });
    doc.setFont("helvetica", "normal");
  }

  function tableHeader(headers: string[], colWidths: number[]): void {
    checkPageBreak(10);
    doc.setFillColor(...COLORS.headerBg);
    doc.rect(margin, y, contentWidth, 6, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.white);
    doc.setFont("helvetica", "bold");
    let x = margin + 1;
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, y + 4);
      x += colWidths[i];
    }
    y += 7;
    doc.setFont("helvetica", "normal");
  }

  function tableRow(cells: string[], colWidths: number[], highlight = false): void {
    checkPageBreak(6);
    if (highlight) {
      doc.setFillColor(254, 243, 199); // amber-100
      doc.rect(margin, y - 1, contentWidth, 5.5, "F");
    }
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.dark);
    let x = margin + 1;
    for (let i = 0; i < cells.length; i++) {
      doc.text(truncate(cells[i], Math.floor(colWidths[i] / 1.8)), x, y + 3);
      x += colWidths[i];
    }
    y += 5.5;
  }

  // ══════════════════════════════════════════════════════════
  // ── COVER / TITLE SECTION ────────────────────────────────
  // ══════════════════════════════════════════════════════════

  // Header bar
  doc.setFillColor(...COLORS.dark);
  doc.rect(0, 0, pageWidth, 45, "F");

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text("VALENTINE RF — SIGINT INTELLIGENCE DIVISION", margin, 12);

  doc.setFontSize(20);
  doc.setTextColor(...COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.text("SIGINT × Conflict Correlation Report", margin, 25);
  doc.setFont("helvetica", "normal");

  doc.setFontSize(9);
  doc.setTextColor(...COLORS.info);
  const subtitle = selectedStation
    ? `Station: ${selectedStation} | Period: ${timeFilter}`
    : `All Stations | Period: ${timeFilter}`;
  doc.text(subtitle, margin, 33);

  doc.setTextColor(...COLORS.muted);
  doc.text(
    `Generated: ${formatDate(new Date().toISOString())} UTC`,
    margin,
    39
  );

  y = 55;

  // ══════════════════════════════════════════════════════════
  // ── EXECUTIVE SUMMARY ────────────────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Executive Summary");

  // Compute stats
  const signalEntries = timeline.filter((e) => e.type === "signal");
  const conflictEntries = timeline.filter((e) => e.type === "conflict");
  const anomalies = signalEntries.filter(
    (e) => e.signalEventType && e.signalEventType !== "normal"
  );
  const highScoreCorrelations = correlations.filter((c) => c.score >= 0.5);

  const boxW = (contentWidth - 6) / 4;
  metricBox(margin, "SIGNAL EVENTS", signalEntries.length.toString(), COLORS.info);
  metricBox(margin + boxW + 2, "CONFLICT EVENTS", conflictEntries.length.toString(), COLORS.danger);
  metricBox(margin + (boxW + 2) * 2, "CORRELATIONS", correlations.length.toString(), COLORS.warning);
  metricBox(margin + (boxW + 2) * 3, "HIGH SCORE", highScoreCorrelations.length.toString(), COLORS.primary);
  y += 22;

  // Summary text
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.dark);
  const summaryLines = [
    `This report covers ${timeline.length} total events across the "${timeFilter}" time window.`,
    `${anomalies.length} signal anomalies were detected across ${new Set(signalEntries.map((e) => e.stationLabel)).size} monitored stations.`,
    `${conflictEntries.length} conflict events from the UCDP GED dataset were included in the analysis.`,
    `${correlations.length} temporal correlations were identified (score ≥ 0.15), of which ${highScoreCorrelations.length} are high-confidence (score ≥ 0.50).`,
  ];
  for (const line of summaryLines) {
    checkPageBreak(5);
    doc.text(line, margin, y);
    y += 4.5;
  }
  y += 4;

  // ══════════════════════════════════════════════════════════
  // ── SIGNAL ANOMALY BREAKDOWN ─────────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Signal Anomaly Breakdown", COLORS.info);

  const anomalyByType = new Map<string, number>();
  for (const a of anomalies) {
    const t = a.signalEventType ?? "unknown";
    anomalyByType.set(t, (anomalyByType.get(t) ?? 0) + 1);
  }

  if (anomalyByType.size > 0) {
    // Bar chart (text-based)
    const maxCount = Math.max(...Array.from(anomalyByType.values()));
    const barMaxWidth = contentWidth - 60;

    for (const [type, count] of Array.from(anomalyByType.entries())) {
      checkPageBreak(8);
      const label = SIGNAL_EVENT_LABELS[type] ?? type;
      const barWidth = (count / maxCount) * barMaxWidth;

      doc.setFontSize(7);
      doc.setTextColor(...COLORS.dark);
      doc.text(label, margin, y + 4);

      const barColor =
        type === "offline" ? COLORS.danger :
        type === "adc_overload" ? COLORS.warning :
        type === "snr_drop" ? COLORS.info :
        COLORS.primary;

      doc.setFillColor(...barColor);
      doc.roundedRect(margin + 35, y, barWidth, 5, 1, 1, "F");

      doc.setTextColor(...COLORS.muted);
      doc.text(`${count}`, margin + 37 + barWidth, y + 4);
      y += 8;
    }
  } else {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text("No signal anomalies detected in this time window.", margin, y);
    y += 6;
  }
  y += 4;

  // ══════════════════════════════════════════════════════════
  // ── CONFLICT EVENT SUMMARY ───────────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Conflict Event Summary by Country", COLORS.danger);

  const byCountry = new Map<string, { count: number; fatalities: number; types: Set<number> }>();
  for (const e of conflictEntries) {
    if (!e.conflictEvent) continue;
    const c = e.conflictEvent.country;
    const existing = byCountry.get(c) ?? { count: 0, fatalities: 0, types: new Set<number>() };
    existing.count++;
    existing.fatalities += e.conflictEvent.best;
    existing.types.add(e.conflictEvent.type);
    byCountry.set(c, existing);
  }

  if (byCountry.size > 0) {
    const colWidths = [45, 25, 30, contentWidth - 100];
    tableHeader(["Country", "Events", "Fatalities", "Violence Types"], colWidths);

    const sorted = Array.from(byCountry.entries()).sort((a, b) => b[1].fatalities - a[1].fatalities);
    for (const [country, stats] of sorted.slice(0, 20)) {
      const types = Array.from(stats.types)
        .map((t) => VIOLENCE_LABELS[t] ?? `Type ${t}`)
        .join(", ");
      tableRow(
        [country, stats.count.toString(), stats.fatalities.toString(), types],
        colWidths,
        stats.fatalities >= 50
      );
    }
    if (sorted.length > 20) {
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.muted);
      doc.text(`... and ${sorted.length - 20} more countries`, margin, y + 3);
      y += 6;
    }
  } else {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text("No conflict events in this time window.", margin, y);
    y += 6;
  }
  y += 4;

  // ══════════════════════════════════════════════════════════
  // ── CORRELATION ANALYSIS TABLE ───────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Correlation Analysis (Top 30)", COLORS.warning);

  if (correlations.length > 0) {
    const colWidths = [12, 30, 22, 25, 18, 15, contentWidth - 122];
    tableHeader(
      ["Score", "Station", "Signal Event", "Conflict", "Country", "Δ Time", "Reason"],
      colWidths
    );

    for (const c of correlations.slice(0, 30)) {
      const scoreStr = (c.score * 100).toFixed(0) + "%";
      const station = c.signalEntry.stationLabel ?? "—";
      const sigType = SIGNAL_EVENT_LABELS[c.signalEntry.signalEventType ?? ""] ?? "—";
      const conflict = c.conflictEntry.conflictEvent?.conflict ?? "—";
      const country = c.conflictEntry.conflictEvent?.country ?? "—";
      const timeDelta = c.timeDeltaHours < 1
        ? `${Math.round(c.timeDeltaHours * 60)}m`
        : `${c.timeDeltaHours.toFixed(1)}h`;

      tableRow(
        [scoreStr, station, sigType, conflict, country, timeDelta, c.reason],
        colWidths,
        c.score >= 0.5
      );
    }

    if (correlations.length > 30) {
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.muted);
      doc.text(
        `... ${correlations.length - 30} additional correlations not shown`,
        margin,
        y + 3
      );
      y += 6;
    }
  } else {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text("No correlations found in this time window.", margin, y);
    y += 6;
  }
  y += 4;

  // ══════════════════════════════════════════════════════════
  // ── STATION ACTIVITY SUMMARY ─────────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Station Activity Summary", COLORS.primary);

  const stationStats = new Map<
    string,
    { entries: number; anomalies: number; avgSnr: number; correlations: number }
  >();
  for (const e of signalEntries) {
    if (!e.stationLabel) continue;
    const s = stationStats.get(e.stationLabel) ?? {
      entries: 0,
      anomalies: 0,
      avgSnr: 0,
      correlations: 0,
    };
    s.entries++;
    if (e.signalEventType && e.signalEventType !== "normal") s.anomalies++;
    if (e.snr !== undefined) s.avgSnr += e.snr;
    stationStats.set(e.stationLabel, s);
  }

  for (const c of correlations) {
    if (c.signalEntry.stationLabel) {
      const s = stationStats.get(c.signalEntry.stationLabel);
      if (s) s.correlations++;
    }
  }

  // Compute averages
  for (const [, s] of Array.from(stationStats.entries())) {
    if (s.entries > 0) s.avgSnr = s.avgSnr / s.entries;
  }

  if (stationStats.size > 0) {
    const colWidths = [50, 25, 25, 25, contentWidth - 125];
    tableHeader(["Station", "Log Entries", "Anomalies", "Avg SNR", "Correlations"], colWidths);

    const sorted = Array.from(stationStats.entries()).sort(
      (a, b) => b[1].correlations - a[1].correlations
    );
    for (const [station, stats] of sorted.slice(0, 25)) {
      tableRow(
        [
          station,
          stats.entries.toString(),
          stats.anomalies.toString(),
          stats.avgSnr > 0 ? `${stats.avgSnr.toFixed(1)} dB` : "N/A",
          stats.correlations.toString(),
        ],
        colWidths,
        stats.correlations > 0
      );
    }
  } else {
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text("No station data available.", margin, y);
    y += 6;
  }
  y += 4;

  // ══════════════════════════════════════════════════════════
  // ── TIMELINE CHART (Text-based) ──────────────────────────
  // ══════════════════════════════════════════════════════════

  sectionTitle("Recent Timeline (Last 20 Events)");

  const recentEvents = timeline.slice(0, 20);
  if (recentEvents.length > 0) {
    for (const entry of recentEvents) {
      checkPageBreak(8);

      // Timeline dot
      const dotColor = entry.type === "signal" ? COLORS.info : COLORS.danger;
      doc.setFillColor(...dotColor);
      doc.circle(margin + 3, y + 2.5, 1.5, "F");

      // Vertical line
      doc.setDrawColor(220, 220, 230);
      doc.setLineWidth(0.3);
      doc.line(margin + 3, y + 4, margin + 3, y + 7);

      // Content
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.dark);
      doc.setFont("helvetica", "bold");

      if (entry.type === "signal") {
        const eventLabel = SIGNAL_EVENT_LABELS[entry.signalEventType ?? ""] ?? "Signal";
        doc.text(`${eventLabel} — ${entry.stationLabel ?? "Unknown"}`, margin + 8, y + 2);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...COLORS.muted);
        const detail = `SNR: ${entry.snr?.toFixed(1) ?? "N/A"} dB | Users: ${entry.users ?? "?"} | ${formatDate(entry.timestamp)}`;
        doc.text(detail, margin + 8, y + 5.5);
      } else if (entry.conflictEvent) {
        const evt = entry.conflictEvent;
        doc.text(
          `${evt.country} — ${truncate(evt.conflict, 40)}`,
          margin + 8,
          y + 2
        );
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...COLORS.muted);
        const typeLabel = VIOLENCE_LABELS[evt.type] ?? `Type ${evt.type}`;
        doc.text(
          `${typeLabel} | ${evt.best} fatalities | ${formatDate(evt.date)}`,
          margin + 8,
          y + 5.5
        );
      }
      y += 8;
    }
  }

  // ══════════════════════════════════════════════════════════
  // ── METHODOLOGY NOTE ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════

  checkPageBreak(30);
  y += 4;
  sectionTitle("Methodology", COLORS.muted);

  doc.setFontSize(7);
  doc.setTextColor(...COLORS.muted);
  const methodLines = [
    "Correlation scoring combines temporal proximity (50% weight), signal severity (up to 30% boost),",
    "and fatality count (up to 20% boost). The time window for correlation is 48 hours.",
    "",
    "Signal anomalies are classified by comparing consecutive log entries: SNR drops > 10dB,",
    "SNR spikes > 15dB, station offline transitions, and ADC overload events.",
    "",
    "Conflict data sourced from UCDP Georeferenced Event Dataset (GED). Violence types:",
    "Type 1 = State-based armed conflict, Type 2 = Non-state conflict, Type 3 = One-sided violence.",
    "",
    "This report is generated for intelligence analysis purposes. Correlations indicate temporal",
    "coincidence and do not imply causation. Manual verification is recommended for all findings.",
  ];
  for (const line of methodLines) {
    checkPageBreak(4);
    doc.text(line, margin, y);
    y += 3.5;
  }

  // Add footer to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter();
  }

  // ── Save ────────────────────────────────────────────────
  const filename = `SIGINT-Conflict-Report-${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}
