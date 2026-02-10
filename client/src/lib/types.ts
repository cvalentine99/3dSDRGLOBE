export interface Receiver {
  label: string;
  version?: string;
  url: string;
  type: "OpenWebRX" | "WebSDR" | "KiwiSDR";
}

export interface Station {
  label: string;
  location: {
    coordinates: [number, number]; // [longitude, latitude]
    type: "Point";
  };
  receivers: Receiver[];
}

export type ReceiverType = "OpenWebRX" | "WebSDR" | "KiwiSDR" | "all";
