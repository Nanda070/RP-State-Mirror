import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SheetError, assertSheetSnapshot, importXlsx, xlsxToSheetSnapshot } from "@mirror/core";

type Snapshot = {
  sheetOrder: string[];
  styles: Record<string, Record<string, unknown>>;
  sheets: Record<
    string,
    {
      name: string;
      cellData: Record<number, Record<number, { v?: unknown; f?: string; s?: string }>>;
      mergeData?: unknown[];
      freeze?: unknown;
      columnData?: Record<number, { w?: number; hd?: number }>;
      rowData?: Record<number, { h?: number; hd?: number }>;
      hidden?: number;
    }
  >;
  resources?: { name: string; data: string }[];
};

async function registry(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Частные адвокаты", { views: [{ state: "frozen", ySplit: 2 }] });
  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = "Реестр";
  sheet.getRow(2).values = ["№", "Имя", "Статус", "Сумма", "Оплачен"];
  const head = sheet.getCell("B2");
  head.font = { name: "Montserrat", size: 12, bold: true, color: { argb: "FFF6B93B" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3A3A3A" } };
  head.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  head.border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  sheet.getColumn(2).width = 30;
  sheet.getColumn(5).hidden = true;
  sheet.getRow(2).height = 30;

  for (const [offset, name] of ["Ramzes Unholly", "Anna Bell", "John Doe"].entries()) {
    const row = 3 + offset;
    sheet.getCell(`A${row}`).value = `A-00${offset + 1}`;
    sheet.getCell(`B${row}`).value = name;
    sheet.getCell(`C${row}`).value = "Активна";
    sheet.getCell(`C${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Активна,Изъята"'] };
    sheet.getCell(`D${row}`).value = 100 * (offset + 1);
    sheet.getCell(`E${row}`).value = offset === 0;
  }
  sheet.getCell("D6").value = { formula: "SUM(D3:D5)", result: 600 };
  sheet.getCell("B7").value = new Date(Date.UTC(2026, 9, 31));
  sheet.getCell("B7").numFmt = "dd.mm.yyyy";

  workbook.addWorksheet("Архив", { state: "hidden" });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("xlsx import", () => {
  it("carries a registry over: values, formulas, look, merges, freeze, lists and checkboxes", async () => {
    const snapshot = (await xlsxToSheetSnapshot(await registry(), "Реестр адвокатов")) as unknown as Snapshot;
    expect(assertSheetSnapshot(snapshot)).toBeGreaterThan(0);
    expect(snapshot.sheetOrder).toEqual(["sheet-1", "sheet-2"]);

    const sheet = snapshot.sheets["sheet-1"];
    expect(sheet?.name).toBe("Частные адвокаты");
    expect(sheet?.cellData[0]?.[0]?.v).toBe("Реестр");
    // The body of the merged heading is not repeated.
    expect(sheet?.cellData[0]?.[1]?.v).toBeUndefined();
    expect(sheet?.mergeData).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 }]);
    expect(sheet?.freeze).toEqual({ xSplit: 0, ySplit: 2, startRow: 2, startColumn: 0 });
    expect(sheet?.cellData[2]?.[1]?.v).toBe("Ramzes Unholly");
    expect(sheet?.cellData[5]?.[3]).toMatchObject({ f: "=SUM(D3:D5)", v: 600 });
    // 31.10.2026 as a serial day number, with its format kept.
    const date = sheet?.cellData[6]?.[1];
    expect(date?.v).toBe(46_326);
    expect(snapshot.styles[date?.s ?? ""]).toMatchObject({ n: { pattern: "dd.mm.yyyy" } });

    const head = snapshot.styles[sheet?.cellData[1]?.[1]?.s ?? ""];
    expect(head).toMatchObject({
      ff: "Montserrat",
      fs: 12,
      bl: 1,
      cl: { rgb: "#f6b93b" },
      bg: { rgb: "#3a3a3a" },
      ht: 2,
      vt: 2,
      tb: 3,
      bd: { b: { s: 8, cl: { rgb: "#000000" } } },
    });
    expect(sheet?.columnData?.[1]?.w).toBe(215);
    expect(sheet?.columnData?.[4]?.hd).toBe(1);
    expect(sheet?.rowData?.[1]?.h).toBe(40);
    expect(snapshot.sheets["sheet-2"]?.hidden).toBe(1);

    // Checkboxes become 1 / 0 with a checkbox rule; the list is one rule over the three cells.
    expect([sheet?.cellData[2]?.[4]?.v, sheet?.cellData[3]?.[4]?.v]).toEqual([1, 0]);
    const rules = JSON.parse(snapshot.resources?.[0]?.data ?? "{}") as Record<string, { type: string; ranges: unknown[]; formula1?: string }[]>;
    expect(snapshot.resources?.[0]?.name).toBe("SHEET_DATA_VALIDATION_PLUGIN");
    expect(rules["sheet-1"]).toEqual([
      expect.objectContaining({
        type: "list",
        formula1: "Активна,Изъята",
        ranges: [{ startRow: 2, endRow: 4, startColumn: 2, endColumn: 2 }],
      }),
      expect.objectContaining({
        type: "checkbox",
        ranges: [{ startRow: 2, endRow: 4, startColumn: 4, endColumn: 4 }],
      }),
    ]);
  });

  it("carries conditional formatting, dropdown chip colours and pictures", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Лицензии");
    sheet.getRow(1).values = ["Имя", "Статус", "Сумма", "Дело"];
    for (let row = 2; row <= 5; row += 1) {
      sheet.getCell(`A${row}`).value = `Адвокат ${row}`;
      sheet.getCell(`B${row}`).value = row % 2 ? "Активна" : "Изъята";
      sheet.getCell(`B${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Активна,Изъята,Приостановлена"'] };
      sheet.getCell(`C${row}`).value = row * 100;
      sheet.getCell(`D${row}`).value = row === 2 ? "Суд №1" : "—";
    }
    const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, bgColor: { argb } });
    sheet.addConditionalFormatting({
      ref: "B2:B5",
      rules: [
        // Google Sheets writes chip colours like this.
        { type: "cellIs", operator: "equal", formulae: ['"Активна"'], priority: 1, style: { fill: solid("FF0B8043") } },
        { type: "cellIs", operator: "equal", formulae: ['"Изъята"'], priority: 2, style: { fill: solid("FFC5221F") } },
      ],
    });
    sheet.addConditionalFormatting({
      ref: "C2:C5",
      rules: [
        {
          type: "cellIs",
          operator: "greaterThan",
          formulae: ["300"],
          priority: 3,
          style: { font: { bold: true, color: { argb: "FFFF0000" } } },
        },
        { type: "cellIs", operator: "between", formulae: ["100", "250"], priority: 4, style: { fill: solid("FFFFFF00") } },
      ],
    });
    sheet.addConditionalFormatting({
      ref: "D2:D5",
      rules: [
        { type: "containsText", operator: "containsText", text: "Суд", priority: 5, style: { fill: solid("FF00FFFF") } },
        { type: "expression", formulae: ['$C2>400'], priority: 6, style: { font: { italic: true } } },
      ],
    });
    sheet.addConditionalFormatting({
      ref: "C2:C5",
      rules: [
        {
          type: "colorScale",
          priority: 7,
          cfvo: [{ type: "min" }, { type: "max" }],
          color: [{ argb: "FFF8696B" }, { argb: "FF63BE7B" }],
        },
        { type: "dataBar", priority: 8, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF638EC6" } } as never,
        {
          type: "iconSet",
          priority: 9,
          iconSet: "3Arrows",
          cfvo: [
            { type: "percent", value: 0 },
            { type: "percent", value: 33 },
            { type: "percent", value: 67 },
          ],
        } as never,
        { type: "top10", priority: 10, rank: 2, style: { fill: solid("FF999999") } } as never,
      ],
    });
    // 1×1 PNG.
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
      (char) => char.charCodeAt(0),
    );
    const imageId = workbook.addImage({ buffer: png as never, extension: "png" });
    sheet.addImage(imageId, { tl: { col: 5, row: 1 }, ext: { width: 100, height: 50 } });
    sheet.addImage(imageId, "H2:I4");
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const stored: string[] = [];
    const { snapshot, report } = await importXlsx(bytes, "Лицензии", {
      storeImage: async (image) => {
        expect(image[0]).toBe(0x89);
        stored.push(`/api/tables/media/file-${stored.length + 1}`);
        return stored[stored.length - 1] ?? null;
      },
    });
    expect(assertSheetSnapshot(snapshot)).toBeGreaterThan(0);
    const resources = Object.fromEntries(
      ((snapshot as unknown as Snapshot).resources ?? []).map((entry) => [entry.name, JSON.parse(entry.data) as Record<string, unknown>]),
    );

    // The chip colours land on the list, in the order of its options; those two rules are not cell highlights.
    const lists = resources.SHEET_DATA_VALIDATION_PLUGIN?.["sheet-1"] as { type: string; formula1?: string; formula2?: string }[];
    expect(lists.find((rule) => rule.type === "list")).toMatchObject({
      formula1: "Активна,Изъята,Приостановлена",
      formula2: "#0b8043,#c5221f,",
    });
    expect(report.listColors).toBe(2);

    const cf = resources.SHEET_CONDITIONAL_FORMATTING_PLUGIN?.["sheet-1"] as { ranges: unknown[]; rule: Record<string, unknown> }[];
    expect(cf.map((entry) => [entry.rule.type, entry.rule.subType ?? null])).toEqual([
      ["highlightCell", "number"],
      ["highlightCell", "number"],
      ["highlightCell", "text"],
      ["highlightCell", "formula"],
      ["colorScale", null],
      ["dataBar", null],
      ["iconSet", null],
      ["highlightCell", "rank"],
    ]);
    expect(cf[0]).toMatchObject({
      ranges: [{ startRow: 1, endRow: 4, startColumn: 2, endColumn: 2 }],
      rule: { operator: "greaterThan", value: 300, style: { bl: 1, cl: { rgb: "#ff0000" } } },
    });
    expect(cf[1]?.rule).toMatchObject({ operator: "between", value: [100, 250], style: { bg: { rgb: "#ffff00" } } });
    expect(cf[2]?.rule).toMatchObject({ operator: "containsText", value: "Суд" });
    expect(cf[3]?.rule).toMatchObject({ value: "=$C2>400", style: { it: 1 } });
    expect(cf[4]?.rule).toMatchObject({
      config: [
        { index: 0, color: "#f8696b", value: { type: "min" } },
        { index: 1, color: "#63be7b", value: { type: "max" } },
      ],
    });
    expect(cf[5]?.rule).toMatchObject({ config: { positiveColor: "#638ec6", min: { type: "min" }, max: { type: "max" } } });
    // Highest icon first: ≥ 67 % — icon 0 (green up), ≥ 33 % — icon 1, the rest — icon 2.
    expect(cf[6]?.rule).toMatchObject({
      config: [
        { operator: "greaterThanOrEqual", value: { type: "percent", value: 67 }, iconType: "3Arrows", iconId: "0" },
        { operator: "greaterThanOrEqual", value: { type: "percent", value: 33 }, iconId: "1" },
        { operator: "lessThan", iconId: "2" },
      ],
    });
    expect(cf[7]?.rule).toMatchObject({ isBottom: false, isPercent: false, value: 2 });
    expect(report).toMatchObject({ conditionalRules: 8, skippedConditionalRules: 0, images: 2, skippedImages: 0 });

    const drawings = resources.SHEET_DRAWING_PLUGIN?.["sheet-1"] as {
      order: string[];
      data: Record<string, { source: string; anchorType: string; sheetTransform: { from: unknown; to: unknown } }>;
    };
    expect(drawings.order).toHaveLength(2);
    const [oneCell, twoCell] = drawings.order.map((id) => drawings.data[id]);
    // 100 px wide from column F (88 px default) ends 12 px into column G; 50 px tall from row 2 ends in row 4.
    expect(oneCell).toMatchObject({
      source: "/api/tables/media/file-1",
      anchorType: "0",
      sheetTransform: {
        from: { column: 5, columnOffset: 0, row: 1, rowOffset: 0 },
        to: { column: 6, columnOffset: 12, row: 3, rowOffset: 2 },
      },
    });
    expect(twoCell).toMatchObject({
      source: "/api/tables/media/file-2",
      anchorType: "1",
      sheetTransform: { from: { column: 7, row: 1 }, to: { column: 9, row: 4 } },
    });

    // Without a store the pictures are left out and counted.
    const { report: plain } = await importXlsx(bytes, "Лицензии");
    expect(plain).toMatchObject({ images: 0, skippedImages: 2 });
  });

  it("refuses what is not a workbook", async () => {
    await expect(xlsxToSheetSnapshot(new Uint8Array(), "x")).rejects.toThrow(/пустой/);
    await expect(xlsxToSheetSnapshot(new TextEncoder().encode("a,b,c\n1,2,3"), "x")).rejects.toThrow(SheetError);
    await expect(xlsxToSheetSnapshot(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "x")).rejects.toThrow(/не удалось прочитать/);
  });
});
