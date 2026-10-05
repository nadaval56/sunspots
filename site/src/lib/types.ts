// Shapes of the JSON written by the pipeline (pipeline/ingest.py, pipeline/daily.py).

export interface FrameEntry {
  t: string; // ISO UTC
  key: string;
  source: "jsoc" | "sdo-hmi" | "sdo-1700" | string;
  cx: number; // 0..1 within the square crop
  cy: number;
  r: number;
  b0: number; // degrees
}

/** latest/channels.json: the newest image in each wavelength, same framing as the hourly frame. */
export interface ChannelEntry {
  id: string;
  label: string;
  t: string;
  key: string;
  key_512?: string;
  source: string;
  cx?: number;
  cy?: number;
  r?: number;
  b0?: number;
  note: string;
}

export interface Channels {
  generated_at: string;
  channels: ChannelEntry[];
}

export interface Manifest {
  generated_at: string;
  latest: FrameEntry | null;
  fallback: boolean;
  frames: FrameEntry[];
}

export interface Region {
  region: number;
  lat: number;
  lon: number; // west positive
  valid_at?: string | null;
  area?: number;
  spots?: number;
  mcintosh?: string | null;
  mag?: string | null;
}

/** regions.json: NOAA's active regions, refreshed by the hourly ingest. */
export interface RegionsFile {
  generated_at: string;
  valid_at: string | null;
  source: string;
  regions: Region[];
}

export interface Today {
  generated_at: string;
  image: FrameEntry | null;
  image_source: string | null;
  fallback_banner: string | null;
  b0: number;
  synthetic?: boolean;
  sunspot_number: { date: string; value: number | null } | null;
  regions: Region[];
  regions_source: string | null;
  flare_probability: { date: string; c: number | null; m: number | null; x: number | null } | null;
  xray: { latest: { t: string; flux: number; class: string }; series: [string, number][] } | null;
  timelapse: { frames: number; from: string; to: string } | null;
  errors: string[];
}

export interface LabFrame {
  date: string;
  t: string;
  key: string;
  jpg: string;
  source: string;
  cx: number;
  cy: number;
  r: number;
  b0: number;
}

/** lab.json (pipeline) and lab-archive/index.json (the bundled sample). */
export interface LabData {
  generated_at: string;
  frames: LabFrame[];
  /** Example track: normalized [x, y] per YYYY-MM-DD, or null (BRIEF §6.4). */
  example_track: Record<string, [number, number]> | null;
  credit?: string;
}

/** daily/index.json: the permanent daily archive. */
export interface DailyIndex {
  days: LabFrame[];
}
