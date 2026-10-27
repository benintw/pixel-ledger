// CSV builder safe for Excel (Traditional Chinese): UTF-8 BOM, CRLF, quoted fields,
// and formula-injection neutralisation for text cells.

const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCsvText(value: string | null | undefined): string {
  let s = value ?? "";
  if (FORMULA_START.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Numeric cells are validated decimal strings and written unquoted so Excel sums them. */
export function csvNumber(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`not a number: ${value}`);
  return value;
}

export type CsvCell = { text: string } | { num: string };

export function buildCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header.map(escapeCsvText).join(",")];
  for (const r of rows) {
    lines.push(r.map((c) => ("num" in c ? csvNumber(c.num) : escapeCsvText(c.text))).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
