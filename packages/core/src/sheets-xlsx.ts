/**
 * `.xlsx` → workbook snapshot of the table editor (PLAN §17, stage C).
 *
 * Carries over what a registry exported from Google Sheets consists of: values, formulas, fonts,
 * fills, borders, alignment, number formats, merged cells, frozen panes, column widths and row
 * heights, hidden rows and columns, dropdown lists and checkboxes. Left behind: pictures, conditional
 * formatting, charts, comments — the editor either has no place for them or the file does not
 * describe them well enough to rebuild.
 *
 * ExcelJS is loaded only when a file is actually imported, so the bot never pays for it.
 */
import type { Cell, CellValue, Worksheet } from "exceljs";
import { SheetError } from "./sheets.js";

export const XLSX_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_CELLS = 250_000;

type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type Style = Record<string, unknown>;

// Numbers the editor understands (its own enums).
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, distributed: 6 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };
const WRAP = 3;
const BORDER: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
const VALUE_STRING = 1;
const VALUE_NUMBER = 2;

/** `FFRRGGBB` → `#rrggbb`; theme and indexed colours cannot be resolved without the theme. */
function rgb(color: { argb?: string } | undefined): { rgb: string } | undefined {
  const argb = color?.argb;
  if (!argb || !/^[0-9a-f]{6,8}$/i.test(argb)) return undefined;
  return { rgb: `#${argb.slice(-6).toLowerCase()}` };
}

function cellStyle(cell: Cell): Style | null {
  const style: Style = {};
  const font = cell.font;
  if (font) {
    if (font.name) style.ff = font.name;
    if (font.size) style.fs = font.size;
    if (font.bold) style.bl = 1;
    if (font.italic) style.it = 1;
    if (font.underline) style.ul = { s: 1 };
    if (font.strike) style.st = { s: 1 };
    const color = rgb(font.color);
    if (color) style.cl = color;
  }
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const color = rgb(fill.fgColor);
    if (color) style.bg = color;
  }
  const alignment = cell.alignment;
  if (alignment) {
    const horizontal = alignment.horizontal ? H_ALIGN[alignment.horizontal] : undefined;
    const vertical = alignment.vertical ? V_ALIGN[alignment.vertical] : undefined;
    if (horizontal) style.ht = horizontal;
    if (vertical) style.vt = vertical;
    if (alignment.wrapText) style.tb = WRAP;
    if (typeof alignment.textRotation === "number" && alignment.textRotation !== 0) {
      style.tr = { a: alignment.textRotation, v: 0 };
    }
  }
  const border = cell.border;
  if (border) {
    const sides: Style = {};
    for (const [key, side] of [
      ["t", border.top],
      ["b", border.bottom],
      ["l", border.left],
      ["r", border.right],
    ] as const) {
      const kind = side?.style ? BORDER[side.style] : undefined;
      if (kind) sides[key] = { s: kind, cl: rgb(side?.color) ?? { rgb: "#000000" } };
    }
    if (Object.keys(sides).length > 0) style.bd = sides;
  }
  if (cell.numFmt && cell.numFmt !== "General") style.n = { pattern: cell.numFmt };
  return Object.keys(style).length > 0 ? style : null;
}

/** A date as the serial number spreadsheets count days with (1900 system). */
function dateSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

function plainValue(value: CellValue): { v?: string | number; t?: number } {
  if (value === null || value === undefined) return {};
  if (typeof value === "number") return { v: value, t: VALUE_NUMBER };
  if (typeof value === "string") return { v: value, t: VALUE_STRING };
  // A checkbox: the editor stores it as 1 / 0.
  if (typeof value === "boolean") return { v: value ? 1 : 0, t: VALUE_NUMBER };
  if (value instanceof Date) return { v: dateSerial(value), t: VALUE_NUMBER };
  if (typeof value === "object") {
    if ("richText" in value) return { v: value.richText.map((part) => part.text).join(""), t: VALUE_STRING };
    if ("hyperlink" in value) return { v: String(value.text ?? value.hyperlink), t: VALUE_STRING };
    if ("error" in value) return { v: String(value.error), t: VALUE_STRING };
  }
  return {};
}

/** `A1:C3` or `B2` → zero-based range. */
function parseRange(address: string): Range | null {
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(address.trim().toUpperCase());
  if (!match) return null;
  const column = (letters: string) => [...letters].reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0) - 1;
  const startColumn = column(match[1] ?? "A");
  const startRow = Number(match[2]) - 1;
  const endColumn = match[3] ? column(match[3]) : startColumn;
  const endRow = match[4] ? Number(match[4]) - 1 : startRow;
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn),
    endColumn: Math.max(startColumn, endColumn),
  };
}

/** Single cells of one column that follow each other are folded into one range. */
function foldCells(cells: { row: number; column: number }[]): Range[] {
  const ranges: Range[] = [];
  const sorted = [...cells].sort((a, b) => a.column - b.column || a.row - b.row);
  for (const cell of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.startColumn === cell.column && last.endRow === cell.row - 1) last.endRow = cell.row;
    else ranges.push({ startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column });
  }
  return ranges;
}

type ValidationRule = { uid: string; type: string; ranges: Range[]; formula1?: string; formula2?: string; allowBlank?: boolean };

function listValidations(sheet: Worksheet, sheetIndex: number): ValidationRule[] {
  const model = (sheet as unknown as { dataValidations?: { model?: Record<string, { type?: string; formulae?: unknown[]; allowBlank?: boolean }> } })
    .dataValidations?.model;
  if (!model) return [];
  // The file lists a rule once per cell: cells with the same list become one rule.
  const byOptions = new Map<string, { row: number; column: number }[]>();
  const wide = new Map<string, Range[]>();
  for (const [address, rule] of Object.entries(model)) {
    if (rule.type !== "list") continue;
    const formula = typeof rule.formulae?.[0] === "string" ? rule.formulae[0] : "";
    // Only lists written out in the rule itself; a list taken from a range of cells is skipped.
    if (!formula.startsWith('"')) continue;
    const options = formula.replace(/^"|"$/g, "");
    const range = parseRange(address.replace(/^range:/, ""));
    if (!range) continue;
    if (range.startRow === range.endRow && range.startColumn === range.endColumn) {
      byOptions.set(options, [...(byOptions.get(options) ?? []), { row: range.startRow, column: range.startColumn }]);
    } else {
      wide.set(options, [...(wide.get(options) ?? []), range]);
    }
  }
  const rules: ValidationRule[] = [];
  for (const options of new Set([...byOptions.keys(), ...wide.keys()])) {
    rules.push({
      uid: `xlsx-list-${sheetIndex}-${rules.length}`,
      type: "list",
      ranges: [...foldCells(byOptions.get(options) ?? []), ...(wide.get(options) ?? [])],
      formula1: options,
      allowBlank: true,
    });
  }
  return rules;
}

/**
 * Reads an `.xlsx` file into a workbook the editor opens. Throws `SheetError` with a message for
 * the person when the file is not a workbook or is too big.
 */
export async function xlsxToSheetSnapshot(bytes: Uint8Array, title: string): Promise<Record<string, unknown>> {
  if (bytes.byteLength === 0) throw new SheetError("Файл пустой.");
  if (bytes.byteLength > XLSX_MAX_BYTES) throw new SheetError("Файл больше 10 МБ.");
  // Every .xlsx is a zip archive.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new SheetError("Это не файл .xlsx. Сохраните таблицу как «Microsoft Excel (.xlsx)».");

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new SheetError("Файл не удалось прочитать: он повреждён или это не .xlsx.");
  }
  if (workbook.worksheets.length === 0) throw new SheetError("В файле нет листов.");
  if (workbook.worksheets.length > MAX_SHEETS) throw new SheetError(`В файле больше ${MAX_SHEETS} листов.`);

  const styles: Record<string, Style> = {};
  const styleIds = new Map<string, string>();
  const styleId = (style: Style): string => {
    const key = JSON.stringify(style);
    let id = styleIds.get(key);
    if (!id) {
      id = `x${styleIds.size + 1}`;
      styleIds.set(key, id);
      styles[id] = style;
    }
    return id;
  };

  const sheets: Record<string, unknown> = {};
  const sheetOrder: string[] = [];
  const validations: Record<string, ValidationRule[]> = {};
  let cells = 0;

  for (const [index, sheet] of workbook.worksheets.entries()) {
    const id = `sheet-${index + 1}`;
    sheetOrder.push(id);

    const cellData: Record<number, Record<number, Record<string, unknown>>> = {};
    const checkboxes: { row: number; column: number }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        // The body of a merged area repeats its first cell: only the first one carries the content.
        const master = cell.isMerged && cell.master.address !== cell.address ? null : cell;
        const data: Record<string, unknown> = {};
        if (master) {
          const formula = cell.formula;
          if (formula) {
            data.f = `=${formula}`;
            Object.assign(data, plainValue(cell.result as CellValue));
          } else {
            Object.assign(data, plainValue(cell.value));
            if (typeof cell.value === "boolean") checkboxes.push({ row: rowNumber - 1, column: columnNumber - 1 });
          }
        }
        const style = cellStyle(cell);
        if (style) data.s = styleId(style);
        if (Object.keys(data).length === 0) return;
        cells += 1;
        if (cells > MAX_CELLS) throw new SheetError("В файле слишком много заполненных ячеек (больше 250 000).");
        (cellData[rowNumber - 1] ??= {})[columnNumber - 1] = data;
      });
    });

    const rowData: Record<number, Record<string, unknown>> = {};
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const entry: Record<string, unknown> = {};
      if (row.height) entry.h = Math.round((row.height * 4) / 3);
      if (row.hidden) entry.hd = 1;
      if (Object.keys(entry).length > 0) rowData[rowNumber - 1] = entry;
    });

    const columnData: Record<number, Record<string, unknown>> = {};
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const info = sheet.getColumn(column);
      const entry: Record<string, unknown> = {};
      // Excel measures width in characters of the default font.
      if (info.width) entry.w = Math.round(info.width * 7 + 5);
      if (info.hidden) entry.hd = 1;
      if (Object.keys(entry).length > 0) columnData[column - 1] = entry;
    }

    const merges = ((sheet.model as { merges?: string[] }).merges ?? [])
      .map((address) => parseRange(address))
      .filter((range): range is Range => range !== null);

    // A sheet without view settings has no `views` at all, whatever the typings say.
    const view = (sheet.views as Worksheet["views"] | null)?.[0];
    const frozen = view && view.state === "frozen" ? { x: view.xSplit ?? 0, y: view.ySplit ?? 0 } : null;

    const rules = listValidations(sheet, index);
    const boxes = foldCells(checkboxes);
    if (boxes.length > 0) {
      rules.push({ uid: `xlsx-checkbox-${index}`, type: "checkbox", ranges: boxes, formula1: "1", formula2: "0" });
    }
    if (rules.length > 0) validations[id] = rules;

    sheets[id] = {
      id,
      name: sheet.name.slice(0, 100) || `Лист${index + 1}`,
      rowCount: Math.max(sheet.rowCount + 50, 200),
      columnCount: Math.max(sheet.columnCount + 5, 26),
      cellData,
      ...(Object.keys(rowData).length > 0 ? { rowData } : {}),
      ...(Object.keys(columnData).length > 0 ? { columnData } : {}),
      ...(merges.length > 0 ? { mergeData: merges } : {}),
      ...(frozen && (frozen.x > 0 || frozen.y > 0)
        ? { freeze: { xSplit: frozen.x, ySplit: frozen.y, startRow: frozen.y, startColumn: frozen.x } }
        : {}),
      ...(sheet.state === "hidden" || sheet.state === "veryHidden" ? { hidden: 1 } : {}),
    };
  }

  return {
    name: title,
    sheetOrder,
    styles,
    sheets,
    ...(Object.keys(validations).length > 0
      ? { resources: [{ name: "SHEET_DATA_VALIDATION_PLUGIN", data: JSON.stringify(validations) }] }
      : {}),
  };
}
