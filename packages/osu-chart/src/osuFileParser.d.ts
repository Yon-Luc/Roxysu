export type OsuParsedData = {
  columnCount: number;
  columns: number[];
  noteStarts: number[];
  noteEnds: number[];
  noteTypes: number[];
  od: number;
  gameMode: string | null;
  status: string;
  lnRatio: number;
  metaData: Record<string, string>;
  breaks: Array<[number, number]>;
  objectIntervals: number[];
};

export declare class OsuFileParser {
  osuText: string;
  od: number;
  columnCount: number;
  columns: number[];
  noteStarts: number[];
  noteEnds: number[];
  noteTypes: number[];
  gameMode: string | null;
  status: string;
  lnRatio: number;
  noteTimes: Record<number, number[]>;
  metaData: Record<string, string>;
  breaks: Array<[number, number]>;
  objectIntervals: number[];
  /** Uninherited timing points as `[timeMs, beatLengthMs]`. */
  timingPoints: Array<[number, number]>;

  constructor(osuText: string);
  getParsedData(): OsuParsedData;
  process(): this;
  getLNRatio(): number;
  getColumnCount(): number;
  getNoteTimes(): Record<number, number[]>;
  getObjectIntervals(): number[];
  getBeatLengthAt(timeMs: number): number;
  modIN(): this;
  modHO(): this;
}
