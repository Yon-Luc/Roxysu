/** Single mania hit object in column/time form. */
export type ChartNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type TimingPoint = [timeMs: number, beatLengthMs: number];

export type ParsedOsuChart = {
  columnCount: number;
  gameMode: string | null;
  status: string;
  lnRatio: number;
  notes: ChartNote[];
  timingPoints: TimingPoint[];
  breaks: Array<[startMs: number, endMs: number]>;
  metaData: Record<string, string>;
};
