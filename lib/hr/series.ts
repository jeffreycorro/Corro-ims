import type { DocumentSeries } from "./types";

/** Representative sequences from the paper formats in the HR spec. */
const EXAMPLE_SEQ: Record<string, number> = {
  CON: 3,
  NTE: 17,
  NOD: 1,
  WW: 1,
  CA: 42,
  LV: 157,
  COE: 1,
  CLR: 2,
  CM: 13,
  DM: 1,
  NCR: 1,
  ALR: 1,
  RM: 1,
  RFFI: 1,
  IR: 1,
  PE: 1,
  OFR: 1,
  PAF: 1,
  MEMO: 1,
};

export function formatDocumentNo(series: DocumentSeries, year: number, seq: number): string {
  const padded = String(seq).padStart(series.padding, "0");
  return series.pattern
    .replaceAll("{PREFIX}", series.prefix)
    .replaceAll("{YYYY}", String(year))
    .replaceAll("{NNNN}", padded)
    .replaceAll("{NNN}", padded)
    .replaceAll("{NN}", padded);
}

export function seriesExample(series: DocumentSeries, year: number): string {
  const seq = EXAMPLE_SEQ[series.key] ?? 1;
  return formatDocumentNo(series, year, seq);
}
