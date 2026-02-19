/**
 * signalClassifier.ts — LLM-based automated signal classification
 *
 * Analyzes signal characteristics (frequency, mode, location, context)
 * and suggests a target category using the built-in LLM integration.
 *
 * Categories: time_signal, broadcast, utility, military, amateur, unknown, custom
 */
import { invokeLLM } from "./_core/llm";

export interface ClassificationInput {
  frequencyKhz: number | null;
  mode?: string | null;
  lat: number;
  lon: number;
  label?: string | null;
  notes?: string | null;
  /** Host names used in the TDoA run */
  hostNames?: string[];
  /** Number of hosts */
  hostCount?: number;
}

export interface ClassificationResult {
  category: string;
  confidence: number; // 0-1
  reasoning: string;
  suggestedLabel?: string;
  knownStation?: string | null;
  signalType?: string;
}

/**
 * Well-known frequency allocations used as context for the LLM.
 * This helps the model make more accurate classifications.
 */
const FREQUENCY_CONTEXT = `
Known frequency allocations (kHz):
- 40, 60, 68.5, 77.5: VLF time signals (JJY, WWVB, BPC, DCF77)
- 162.0: MSF Rugby time signal
- 198: BBC Radio 4 longwave broadcast
- 500: Maritime distress (historical)
- 530-1700: AM broadcast band (MW)
- 2182: Maritime distress/calling
- 2500, 5000, 10000, 15000, 20000, 25000: WWV/WWVH time signals
- 3330, 7850, 14670: CHU Canada time signals
- 4996, 9996, 14996: RWM Russia time signals
- 2850-22000: HF aeronautical (VOLMET, LDOC)
- 3500-4000: 80m amateur band
- 5351.5-5366.5: 60m amateur band
- 7000-7300: 40m amateur band
- 10100-10150: 30m amateur band
- 14000-14350: 20m amateur band
- 18068-18168: 17m amateur band
- 21000-21450: 15m amateur band
- 24890-24990: 12m amateur band
- 28000-29700: 10m amateur band
- 3000-30000: HF utility (STANAG, ALE, HFDL, etc.)
- 4000-4063: Fixed/mobile maritime
- 6200-6525: Maritime mobile
- 8100-8815: Maritime mobile
- 12230-13200: Maritime mobile
- 3000-3400: 80m military (NATO)
- 4000-4650: Military HF
- 5700-6200: Military HF
- 6765-7000: Military HF
- 8815-8965: Military HF
- 11175: USAF HFGCS (Mystic Star)
- 4724, 6739, 8992, 11175, 13200, 15016: USAF HFGCS frequencies
- 4625: UVB-76 "The Buzzer" (Russia)
- 5473, 6945, 8125, 10125: Numbers stations (common)
`;

/**
 * Classify a signal using LLM analysis of its characteristics.
 */
export async function classifySignal(
  input: ClassificationInput
): Promise<ClassificationResult> {
  const freqStr = input.frequencyKhz
    ? `${input.frequencyKhz} kHz (${(input.frequencyKhz / 1000).toFixed(3)} MHz)`
    : "Unknown frequency";

  const locationStr = `${input.lat.toFixed(4)}°N, ${input.lon.toFixed(4)}°E`;

  const prompt = `You are an expert radio frequency analyst and SIGINT specialist. Analyze the following signal characteristics and classify it into one of these categories:

Categories:
- time_signal: Time and frequency standard stations (WWV, CHU, DCF77, JJY, MSF, BPC, RWM, WWVH, WWVB)
- broadcast: AM/FM/SW broadcast stations (BBC, VOA, Radio China, etc.)
- utility: Non-military utility stations (weather fax, VOLMET, maritime coast stations, NAVTEX)
- military: Military communications (HFGCS, STANAG, ALE military nets, radar, OTH)
- amateur: Amateur (ham) radio operators and beacons
- unknown: Cannot determine with reasonable confidence
- custom: Unusual or unique signals that don't fit other categories (numbers stations, UVB-76, etc.)

Signal characteristics:
- Frequency: ${freqStr}
- Mode: ${input.mode || "Unknown"}
- Estimated position: ${locationStr}
- Label: ${input.label || "None"}
- Notes: ${input.notes || "None"}
- Hosts used: ${input.hostCount || "Unknown"} KiwiSDR receivers
${input.hostNames?.length ? `- Host names: ${input.hostNames.join(", ")}` : ""}

${FREQUENCY_CONTEXT}

Based on the frequency, mode, geographic position, and any contextual clues, classify this signal.`;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a radio frequency classification expert. Always respond with valid JSON matching the required schema. Be specific in your reasoning.",
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "signal_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: [
                  "time_signal",
                  "broadcast",
                  "utility",
                  "military",
                  "amateur",
                  "unknown",
                  "custom",
                ],
                description: "The classified category",
              },
              confidence: {
                type: "number",
                description:
                  "Confidence level from 0.0 to 1.0 (1.0 = certain)",
              },
              reasoning: {
                type: "string",
                description:
                  "Brief explanation of why this classification was chosen",
              },
              suggestedLabel: {
                type: "string",
                description:
                  "A better label for the target if the current one is generic",
              },
              knownStation: {
                type: ["string", "null"],
                description:
                  "Name of the known station if identified (e.g. 'WWV Fort Collins', 'BBC Radio 4')",
              },
              signalType: {
                type: "string",
                description:
                  "Specific signal type (e.g. 'AM broadcast', 'CW time signal', 'USB HFGCS')",
              },
            },
            required: [
              "category",
              "confidence",
              "reasoning",
              "suggestedLabel",
              "knownStation",
              "signalType",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error("Empty LLM response");
    }

    const parsed = JSON.parse(content) as ClassificationResult;

    // Validate category is in our enum
    const validCategories = [
      "time_signal",
      "broadcast",
      "utility",
      "military",
      "amateur",
      "unknown",
      "custom",
    ];
    if (!validCategories.includes(parsed.category)) {
      parsed.category = "unknown";
    }

    // Clamp confidence
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

    return parsed;
  } catch (error) {
    console.error("[SignalClassifier] LLM classification failed:", error);
    // Return a fallback classification based on frequency heuristics
    return fallbackClassification(input);
  }
}

/**
 * Fallback classification using simple frequency-based heuristics
 * when the LLM is unavailable.
 */
function fallbackClassification(
  input: ClassificationInput
): ClassificationResult {
  const freq = input.frequencyKhz;

  if (!freq) {
    return {
      category: "unknown",
      confidence: 0.1,
      reasoning: "No frequency data available for classification",
      signalType: "Unknown",
    };
  }

  // Time signals
  const timeFreqs = [
    40, 60, 68.5, 77.5, 162, 2500, 3330, 5000, 7850, 10000, 14670, 15000,
    20000, 25000, 4996, 9996, 14996,
  ];
  if (timeFreqs.some((f) => Math.abs(f - freq) < 5)) {
    return {
      category: "time_signal",
      confidence: 0.85,
      reasoning: `Frequency ${freq} kHz matches a known time signal allocation`,
      signalType: "Time signal",
      knownStation: identifyTimeStation(freq),
    };
  }

  // AM broadcast
  if (freq >= 530 && freq <= 1700) {
    return {
      category: "broadcast",
      confidence: 0.8,
      reasoning: `Frequency ${freq} kHz is in the AM broadcast band (530-1700 kHz)`,
      signalType: "AM broadcast",
    };
  }

  // Shortwave broadcast bands
  const swBands = [
    [5900, 6200],
    [7200, 7450],
    [9400, 9900],
    [11600, 12100],
    [13570, 13870],
    [15100, 15800],
    [17480, 17900],
    [21450, 21850],
    [25670, 26100],
  ];
  if (swBands.some(([lo, hi]) => freq >= lo && freq <= hi)) {
    return {
      category: "broadcast",
      confidence: 0.75,
      reasoning: `Frequency ${freq} kHz is in a shortwave broadcast band`,
      signalType: "Shortwave broadcast",
    };
  }

  // Amateur bands
  const hamBands = [
    [1800, 2000],
    [3500, 4000],
    [5351.5, 5366.5],
    [7000, 7300],
    [10100, 10150],
    [14000, 14350],
    [18068, 18168],
    [21000, 21450],
    [24890, 24990],
    [28000, 29700],
  ];
  if (hamBands.some(([lo, hi]) => freq >= lo && freq <= hi)) {
    return {
      category: "amateur",
      confidence: 0.7,
      reasoning: `Frequency ${freq} kHz is in an amateur radio band`,
      signalType: "Amateur radio",
    };
  }

  // USAF HFGCS
  const hfgcsFreqs = [4724, 6739, 8992, 11175, 13200, 15016];
  if (hfgcsFreqs.some((f) => Math.abs(f - freq) < 2)) {
    return {
      category: "military",
      confidence: 0.9,
      reasoning: `Frequency ${freq} kHz matches USAF HFGCS allocation`,
      signalType: "USB military HFGCS",
      knownStation: "USAF HFGCS (Mystic Star)",
    };
  }

  // Maritime
  if (Math.abs(freq - 2182) < 2) {
    return {
      category: "utility",
      confidence: 0.85,
      reasoning: "2182 kHz is the international maritime distress/calling frequency",
      signalType: "Maritime distress/calling",
    };
  }

  // UVB-76
  if (Math.abs(freq - 4625) < 2) {
    return {
      category: "custom",
      confidence: 0.9,
      reasoning: "4625 kHz is the frequency of UVB-76 'The Buzzer'",
      signalType: "Buzzer signal",
      knownStation: "UVB-76 (The Buzzer)",
    };
  }

  // Default for HF
  if (freq >= 3000 && freq <= 30000) {
    return {
      category: "utility",
      confidence: 0.3,
      reasoning: `Frequency ${freq} kHz is in the HF band but doesn't match known allocations`,
      signalType: "HF utility (unidentified)",
    };
  }

  return {
    category: "unknown",
    confidence: 0.2,
    reasoning: `Frequency ${freq} kHz does not match any known allocation pattern`,
    signalType: "Unknown",
  };
}

function identifyTimeStation(freq: number): string | null {
  const stations: Record<number, string> = {
    40: "JJY (Japan, 40 kHz)",
    60: "WWVB (USA) / MSF (UK) / JJY (Japan, 60 kHz)",
    68.5: "BPC (China)",
    77.5: "DCF77 (Germany)",
    162: "MSF (UK, 162 kHz — historical)",
    2500: "WWV/WWVH (2.5 MHz)",
    3330: "CHU (Canada, 3.330 MHz)",
    5000: "WWV/WWVH (5 MHz)",
    7850: "CHU (Canada, 7.850 MHz)",
    10000: "WWV/WWVH (10 MHz)",
    14670: "CHU (Canada, 14.670 MHz)",
    15000: "WWV/WWVH (15 MHz)",
    20000: "WWV (20 MHz)",
    25000: "WWV (25 MHz — experimental)",
    4996: "RWM (Russia, 4.996 MHz)",
    9996: "RWM (Russia, 9.996 MHz)",
    14996: "RWM (Russia, 14.996 MHz)",
  };
  return stations[Math.round(freq)] || null;
}
