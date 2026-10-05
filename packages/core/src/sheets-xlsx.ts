/**
 * `.xlsx` → workbook snapshot of the table editor (PLAN §17, stage C).
 *
 * Carries over what a registry exported from Google Sheets consists of: values, formulas, fonts,
 * fills, borders, alignment, number formats, merged cells, frozen panes, column widths and row
 * heights, hidden rows and columns, dropdown lists with the colours of their chips, checkboxes,
 * pictures over the grid and conditional formatting (highlight rules, colour scales, data bars,
 * icon sets). Left behind: charts, pivot tables, comments and pictures inside cells — the editor
 * has no place for them.
 *
 * Google Sheets writes the chip colours of a dropdown as «equal to <option>» highlight rules over
 * the dropdown's cells; such rules become the list's own colours instead of a cell highlight.
 *
 * ExcelJS is loaded only when a file is actually imported, so the bot never pays for it.
 */
import type { Cell, CellValue, Workbook, Worksheet } from "exceljs";
import { SheetError } from "./sheets.js";

export const XLSX_MAX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_CELLS = 250_000;
const MAX_IMAGES = 50;
// The editor's own sizes for a column and a row nobody resized, in pixels.
const DEFAULT_COLUMN_PX = 88;
const DEFAULT_ROW_PX = 24;
const EMU_PER_PX = 9525;

/** Stores one picture of the file and returns the address the workbook keeps (null: not a picture we take). */
export type XlsxImageStore = (bytes: Uint8Array, name: string) => Promise<string | null>;

/** What the import carried over and what it had to leave behind, for the person who imported. */
export type XlsxImportReport = {
  images: number;
  skippedImages: number;
  conditionalRules: number;
  skippedConditionalRules: number;
  listColors: number;
};

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

/** Font and fill of a conditional-format rule (the file's «dxf» style) in the editor's terms. */
function ruleStyle(style: { font?: Cell["font"]; fill?: Cell["fill"] } | undefined): Style {
  const result: Style = {};
  const font = style?.font;
  if (font) {
    if (font.bold) result.bl = 1;
    if (font.italic) result.it = 1;
    if (font.underline) result.ul = { s: 1 };
    if (font.strike) result.st = { s: 1 };
    const color = rgb(font.color);
    if (color) result.cl = color;
  }
  const fill = style?.fill;
  if (fill && fill.type === "pattern") {
    // In a rule's style the colour of a solid fill sits in bgColor; files written by hand use fgColor.
    const color = rgb(fill.bgColor) ?? rgb(fill.fgColor);
    if (color) result.bg = color;
  }
  return result;
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

// ── Conditional formatting ──────────────────────────────────────────────────────────────

type CfValue = { type?: string; value?: number };
type XlsxCfRule = {
  type?: string;
  operator?: string;
  formulae?: unknown[];
  style?: { font?: Cell["font"]; fill?: Cell["fill"] };
  priority?: number;
  timePeriod?: string;
  percent?: boolean;
  bottom?: boolean;
  rank?: number;
  aboveAverage?: boolean;
  cfvo?: CfValue[];
  color?: { argb?: string }[] | { argb?: string };
  iconSet?: string;
  reverse?: boolean;
  showValue?: boolean;
};
type CfRule = { cfId: string; ranges: Range[]; stopIfTrue: boolean; rule: Record<string, unknown> };

const NUMBER_OPERATORS = new Set([
  "equal",
  "notEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "notBetween",
]);
const TEXT_OPERATORS: Record<string, string> = {
  containsText: "containsText",
  notContains: "notContainsText",
  notContainsText: "notContainsText",
  beginsWith: "beginsWith",
  endsWith: "endsWith",
  containsBlanks: "containsBlanks",
  notContainsBlanks: "notContainsBlanks",
  containsErrors: "containsErrors",
  notContainsErrors: "notContainsErrors",
};
const TIME_PERIODS = new Set([
  "today",
  "yesterday",
  "tomorrow",
  "last7Days",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "thisWeek",
  "lastWeek",
  "nextWeek",
]);
const ICON_SETS = new Set([
  "3Arrows",
  "3ArrowsGray",
  "4Arrows",
  "4ArrowsGray",
  "5Arrows",
  "5ArrowsGray",
  "3Triangles",
  "3TrafficLights1",
  "3Signs",
  "3TrafficLights2",
  "4RedToBlack",
  "4TrafficLights",
  "3Symbols",
  "3Symbols2",
  "3Flags",
  "4Rating",
  "5Rating",
  "5Quarters",
  "5Boxes",
  "3Stars",
]);
const CF_VALUE_TYPES: Record<string, string> = {
  min: "min",
  max: "max",
  num: "num",
  percent: "percent",
  percentile: "percentile",
};

/** A formula operand of a rule: a number, a quoted text, or anything else (a reference, a formula). */
function operand(raw: unknown): { number: number } | { text: string } | { formula: string } | null {
  if (typeof raw === "number") return { number: raw };
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value)) return { number: Number(value) };
  const quoted = /^"((?:[^"]|"")*)"$/.exec(value);
  if (quoted) return { text: (quoted[1] ?? "").replace(/""/g, '"') };
  return value ? { formula: value } : null;
}

/** Top-left cell of a range in A1 notation, the cell relative formulas of a rule are written for. */
function topLeft(range: Range): string {
  let column = "";
  for (let index = range.startColumn + 1; index > 0; index = Math.floor((index - 1) / 26)) {
    column = String.fromCharCode(65 + ((index - 1) % 26)) + column;
  }
  return `${column}${range.startRow + 1}`;
}

const COMPARE: Record<string, string> = {
  equal: "=",
  notEqual: "<>",
  greaterThan: ">",
  greaterThanOrEqual: ">=",
  lessThan: "<",
  lessThanOrEqual: "<=",
};

function cfValue(raw: CfValue | undefined, fallback: string): { type: string; value?: number } {
  const type = raw?.type ? CF_VALUE_TYPES[raw.type] : undefined;
  if (!type) return { type: fallback };
  if (type === "min" || type === "max") return { type };
  return { type, value: Number.isFinite(raw?.value) ? Number(raw?.value) : 0 };
}

function colorList(color: XlsxCfRule["color"]): string[] {
  const list = Array.isArray(color) ? color : color ? [color] : [];
  return list.map((entry) => rgb(entry)?.rgb ?? "#ffffff");
}

/** One rule of the file in the editor's terms, or null when the editor cannot show it. */
function convertCfRule(rule: XlsxCfRule, ranges: Range[]): Record<string, unknown> | null {
  const first = ranges[0];
  if (!first) return null;
  const highlight = (subType: string, extra: Record<string, unknown>) => ({
    type: "highlightCell",
    subType,
    style: ruleStyle(rule.style),
    ...extra,
  });
  const formulae = rule.formulae ?? [];

  switch (rule.type) {
    case "cellIs": {
      const operator = rule.operator ?? "";
      if (!NUMBER_OPERATORS.has(operator)) return null;
      const operands = formulae.map(operand);
      if (operands.some((value) => value === null)) return null;
      const numbers = operands.map((value) => (value && "number" in value ? value.number : null));
      if (numbers.every((value) => value !== null)) {
        const value = operator === "between" || operator === "notBetween" ? [numbers[0], numbers[1] ?? numbers[0]] : numbers[0];
        return highlight("number", { operator, value });
      }
      const text = operands[0];
      if (operands.length === 1 && text && "text" in text && (operator === "equal" || operator === "notEqual")) {
        return highlight("text", { operator, value: text.text });
      }
      // References or formulas: the same comparison as a formula over the first cell.
      const cell = topLeft(first);
      const raw = formulae.map((value) => String(value));
      if (operator === "between" || operator === "notBetween") {
        const inside = `AND(${cell}>=${raw[0]},${cell}<=${raw[1] ?? raw[0]})`;
        return highlight("formula", { value: `=${operator === "between" ? inside : `NOT(${inside})`}` });
      }
      return highlight("formula", { value: `=${cell}${COMPARE[operator]}${raw[0]}` });
    }
    case "expression": {
      const formula = typeof formulae[0] === "string" ? formulae[0].trim() : "";
      return formula ? highlight("formula", { value: `=${formula.replace(/^=/, "")}` }) : null;
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      const operator = TEXT_OPERATORS[rule.operator ?? rule.type] ?? TEXT_OPERATORS[rule.type];
      if (!operator) return null;
      if (operator.endsWith("Blanks") || operator.endsWith("Errors")) return highlight("text", { operator });
      // The file keeps the searched text only inside the rule's formula: SEARCH("text",A1) and the like.
      const formula = typeof formulae[0] === "string" ? formulae[0] : "";
      const quoted = /"((?:[^"]|"")*)"/.exec(formula);
      if (!quoted) return null;
      return highlight("text", { operator, value: (quoted[1] ?? "").replace(/""/g, '"') });
    }
    case "timePeriod":
      return rule.timePeriod && TIME_PERIODS.has(rule.timePeriod) ? highlight("timePeriod", { operator: rule.timePeriod }) : null;
    case "top10":
      return highlight("rank", { isBottom: !!rule.bottom, isPercent: !!rule.percent, value: rule.rank ?? 10 });
    case "aboveAverage":
      return highlight("average", { operator: rule.aboveAverage === false ? "lessThan" : "greaterThan" });
    case "duplicateValues":
      return highlight("duplicateValues", {});
    case "uniqueValues":
      return highlight("uniqueValues", {});
    case "colorScale": {
      const colors = colorList(rule.color);
      const stops = rule.cfvo ?? [];
      if (stops.length < 2 || colors.length < stops.length) return null;
      return {
        type: "colorScale",
        config: stops.map((stop, index) => ({
          index,
          color: colors[index],
          value: cfValue(stop, index === 0 ? "min" : index === stops.length - 1 ? "max" : "percentile"),
        })),
      };
    }
    case "dataBar": {
      const [min, max] = rule.cfvo ?? [];
      return {
        type: "dataBar",
        isShowValue: rule.showValue !== false,
        config: {
          min: cfValue(min, "min"),
          max: cfValue(max, "max"),
          isGradient: true,
          positiveColor: colorList(rule.color)[0] ?? "#638ec6",
          nativeColor: "#ff0000",
        },
      };
    }
    case "iconSet": {
      const name = rule.iconSet ?? "3TrafficLights1";
      // Excel's default set has no number in its name.
      const iconType = name === "3TrafficLights" ? "3TrafficLights1" : name;
      const stops = rule.cfvo ?? [];
      if (!ICON_SETS.has(iconType) || stops.length < 2) return null;
      const count = stops.length;
      // The file lists thresholds from the lowest icon up; the editor checks from the highest icon down.
      const config = Array.from({ length: count }, (_, index) => {
        const level = count - 1 - index;
        const threshold = stops[Math.max(level, 1)];
        const icon = rule.reverse ? count - 1 - index : index;
        return {
          operator: level === 0 ? "lessThan" : "greaterThanOrEqual",
          value: cfValue(threshold, "percent"),
          iconType,
          iconId: String(icon),
        };
      });
      return { type: "iconSet", isShowValue: rule.showValue !== false, config };
    }
    default:
      return null;
  }
}

function rangesOf(ref: string | undefined): Range[] {
  return (ref ?? "")
    .split(/\s+/)
    .map((part) => parseRange(part))
    .filter((range): range is Range => range !== null);
}

function overlaps(a: Range, b: Range): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
}

/**
 * Turns the sheet's conditional formatting into the editor's rules. «Equal to <option>» rules that
 * paint the cells of a dropdown give the list its chip colours instead (that is how Google Sheets
 * exports them).
 */
function convertConditionalFormatting(
  sheet: Worksheet,
  sheetIndex: number,
  lists: ValidationRule[],
  report: XlsxImportReport,
): CfRule[] {
  const blocks = (sheet as unknown as { conditionalFormattings?: { ref?: string; rules?: XlsxCfRule[] }[] })
    .conditionalFormattings ?? [];
  const entries = blocks
    .flatMap((block) => (block.rules ?? []).map((rule) => ({ rule, ranges: rangesOf(block.ref) })))
    .filter((entry) => entry.ranges.length > 0)
    .sort((a, b) => (a.rule.priority ?? Number.MAX_SAFE_INTEGER) - (b.rule.priority ?? Number.MAX_SAFE_INTEGER));

  const listColors = new Map<ValidationRule, Map<string, string>>();
  const rules: CfRule[] = [];
  for (const { rule, ranges } of entries) {
    if (rule.type === "cellIs" && rule.operator === "equal" && (rule.formulae ?? []).length === 1) {
      const value = operand(rule.formulae?.[0]);
      const fill = ruleStyle(rule.style).bg as { rgb: string } | undefined;
      const list =
        value && "text" in value && fill
          ? lists.find(
              (candidate) =>
                candidate.type === "list" &&
                listOptions(candidate).includes(value.text) &&
                ranges.every((range) => candidate.ranges.some((own) => overlaps(range, own))),
            )
          : undefined;
      if (list && value && "text" in value && fill) {
        const colors = listColors.get(list) ?? new Map<string, string>();
        if (!colors.has(value.text)) colors.set(value.text, fill.rgb);
        listColors.set(list, colors);
        continue;
      }
    }
    const converted = convertCfRule(rule, ranges);
    if (!converted) {
      report.skippedConditionalRules += 1;
      continue;
    }
    rules.push({ cfId: `xlsx-cf-${sheetIndex}-${rules.length}`, ranges, stopIfTrue: false, rule: converted });
  }
  report.conditionalRules += rules.length;

  for (const [list, colors] of listColors) {
    // The editor keeps the colours in formula2, in the same order as the options.
    list.formula2 = listOptions(list).map((option) => colors.get(option) ?? "").join(",");
    report.listColors += colors.size;
  }
  return rules;
}

function listOptions(rule: ValidationRule): string[] {
  return (rule.formula1 ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
}

// ── Pictures ────────────────────────────────────────────────────────────────────────────────

type GridPoint = { column: number; columnOffset: number; row: number; rowOffset: number };

/** Walks the grid from a cell by a distance in pixels: where a picture of that size ends. */
function advance(start: number, offset: number, distance: number, size: (index: number) => number) {
  let index = start;
  let rest = offset + distance;
  while (rest > size(index) && index < 100_000) {
    rest -= size(index);
    index += 1;
  }
  return { index, offset: Math.max(0, rest) };
}

async function convertImages(
  workbook: Workbook,
  sheet: Worksheet,
  subUnitId: string,
  sizes: { column: (index: number) => number; row: (index: number) => number },
  storeImage: XlsxImageStore | undefined,
  report: XlsxImportReport,
): Promise<Record<string, unknown> | null> {
  const images = sheet.getImages();
  if (images.length === 0) return null;
  const data: Record<string, unknown> = {};
  const order: string[] = [];
  for (const image of images) {
    const source = workbook.getImage(Number(image.imageId)) as unknown as { buffer?: Uint8Array; extension?: string } | undefined;
    const tl = image.range.tl as unknown as { nativeCol: number; nativeColOff: number; nativeRow: number; nativeRowOff: number };
    const br = image.range.br as unknown as typeof tl | undefined;
    const ext = (image.range as unknown as { ext?: { width?: number; height?: number } }).ext;
    if (!storeImage || !source?.buffer || report.images >= MAX_IMAGES || (!br && !(ext?.width && ext.height))) {
      report.skippedImages += 1;
      continue;
    }
    const url = await storeImage(new Uint8Array(source.buffer), `${sheet.name}-${order.length + 1}.${source.extension ?? "png"}`);
    if (!url) {
      report.skippedImages += 1;
      continue;
    }
    const from: GridPoint = {
      column: tl.nativeCol,
      columnOffset: Math.round(tl.nativeColOff / EMU_PER_PX),
      row: tl.nativeRow,
      rowOffset: Math.round(tl.nativeRowOff / EMU_PER_PX),
    };
    let to: GridPoint;
    if (br) {
      to = {
        column: br.nativeCol,
        columnOffset: Math.round(br.nativeColOff / EMU_PER_PX),
        row: br.nativeRow,
        rowOffset: Math.round(br.nativeRowOff / EMU_PER_PX),
      };
    } else {
      const across = advance(from.column, from.columnOffset, ext?.width ?? 0, sizes.column);
      const down = advance(from.row, from.rowOffset, ext?.height ?? 0, sizes.row);
      to = { column: across.index, columnOffset: Math.round(across.offset), row: down.index, rowOffset: Math.round(down.offset) };
    }
    const drawingId = `xlsx-image-${subUnitId}-${order.length + 1}`;
    const position = { from, to };
    data[drawingId] = {
      // The editor puts the table's own id here when it opens the workbook.
      unitId: "",
      subUnitId,
      drawingId,
      drawingType: 0,
      imageSourceType: "URL",
      source: url,
      sheetTransform: position,
      axisAlignSheetTransform: position,
      // A two-cell picture stretches with its cells, a one-cell picture only moves.
      anchorType: br ? "1" : "0",
    };
    order.push(drawingId);
    report.images += 1;
  }
  return order.length > 0 ? { data, order } : null;
}

/**
 * Reads an `.xlsx` file into a workbook the editor opens. Throws `SheetError` with a message for
 * the person when the file is not a workbook or is too big. Pictures are kept only when
 * `storeImage` is given: the workbook holds their address, not their bytes.
 */
export async function importXlsx(
  bytes: Uint8Array,
  title: string,
  options: { storeImage?: XlsxImageStore } = {},
): Promise<{ snapshot: Record<string, unknown>; report: XlsxImportReport }> {
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
  const conditional: Record<string, CfRule[]> = {};
  const drawings: Record<string, unknown> = {};
  const report: XlsxImportReport = { images: 0, skippedImages: 0, conditionalRules: 0, skippedConditionalRules: 0, listColors: 0 };
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
    const cfRules = convertConditionalFormatting(sheet, index, rules, report);
    if (cfRules.length > 0) conditional[id] = cfRules;
    const boxes = foldCells(checkboxes);
    if (boxes.length > 0) {
      rules.push({ uid: `xlsx-checkbox-${index}`, type: "checkbox", ranges: boxes, formula1: "1", formula2: "0" });
    }
    if (rules.length > 0) validations[id] = rules;

    const pictures = await convertImages(
      workbook,
      sheet,
      id,
      {
        column: (column) => {
          const entry = columnData[column];
          return entry?.hd ? 0 : typeof entry?.w === "number" ? entry.w : DEFAULT_COLUMN_PX;
        },
        row: (row) => {
          const entry = rowData[row];
          return entry?.hd ? 0 : typeof entry?.h === "number" ? entry.h : DEFAULT_ROW_PX;
        },
      },
      options.storeImage,
      report,
    );
    if (pictures) drawings[id] = pictures;

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

  const resources = [
    ...(Object.keys(validations).length > 0
      ? [{ name: "SHEET_DATA_VALIDATION_PLUGIN", data: JSON.stringify(validations) }]
      : []),
    ...(Object.keys(conditional).length > 0
      ? [{ name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN", data: JSON.stringify(conditional) }]
      : []),
    ...(Object.keys(drawings).length > 0 ? [{ name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify(drawings) }] : []),
  ];
  return {
    snapshot: { name: title, sheetOrder, styles, sheets, ...(resources.length > 0 ? { resources } : {}) },
    report,
  };
}

/** The workbook alone, without pictures (see `importXlsx`). */
export async function xlsxToSheetSnapshot(bytes: Uint8Array, title: string): Promise<Record<string, unknown>> {
  return (await importXlsx(bytes, title)).snapshot;
}
