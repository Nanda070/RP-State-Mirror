import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SheetError, assertSheetSnapshot, xlsxToSheetSnapshot } from "@mirror/core";

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

  it("refuses what is not a workbook", async () => {
    await expect(xlsxToSheetSnapshot(new Uint8Array(), "x")).rejects.toThrow(/пустой/);
    await expect(xlsxToSheetSnapshot(new TextEncoder().encode("a,b,c\n1,2,3"), "x")).rejects.toThrow(SheetError);
    await expect(xlsxToSheetSnapshot(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "x")).rejects.toThrow(/не удалось прочитать/);
  });
});
