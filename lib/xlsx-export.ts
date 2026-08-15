import * as XLSX from "xlsx";

export interface XlsxColumn<T> {
  header: string;
  /** Return a string/number for the cell, or null/undefined for a blank cell. */
  accessor: (row: T) => string | number | null | undefined;
}

/**
 * A single sheet already flattened to plain header + row-of-cells arrays.
 * Deliberately non-generic — a workbook with multiple sheets (e.g. Sales
 * rows + a Revenue-by-Type breakdown) mixes unrelated row shapes, and
 * flattening at `toSheetData` (where the concrete row type is still known)
 * avoids needing a variance-unsafe `any` anywhere in the shared workbook code.
 */
export interface XlsxSheetData {
  sheetName: string;
  header: string[];
  rows: (string | number)[][];
}

/** Converts typed rows + column defs into a flattened sheet, ready for `downloadXlsxWorkbook`. */
export function toSheetData<T>(sheetName: string, columns: XlsxColumn<T>[], rows: T[]): XlsxSheetData {
  return {
    sheetName,
    header: columns.map((c) => c.header),
    rows: rows.map((row) => columns.map((c) => c.accessor(row) ?? "")),
  };
}

/**
 * Builds a .xlsx workbook (one or more sheets) from in-memory rows already
 * loaded on screen, and triggers a browser download. Client-side only —
 * every Report already has its currently-filtered data in React state, so
 * there's no need for a server round trip just to export it.
 */
export function downloadXlsxWorkbook(filename: string, sheets: XlsxSheetData[]): void {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]);
    worksheet["!cols"] = sheet.header.map(() => ({ wch: 18 }));
    // Excel caps sheet names at 31 characters and rejects some symbols.
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName.slice(0, 31));
  }
  const safeFilename = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, safeFilename);
}

/** Convenience wrapper for the common single-sheet case. */
export function downloadXlsx<T>(filename: string, sheetName: string, columns: XlsxColumn<T>[], rows: T[]): void {
  downloadXlsxWorkbook(filename, [toSheetData(sheetName, columns, rows)]);
}

/** "2026-08-02", for building report filenames from the moment of export. */
export function todayForFilename(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
