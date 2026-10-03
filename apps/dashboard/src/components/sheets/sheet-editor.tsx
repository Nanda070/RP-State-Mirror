"use client";

import { ICanvasColorService } from "@univerjs/engine-render";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import conditionalFormattingRu from "@univerjs/preset-sheets-conditional-formatting/locales/ru-RU";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import coreRu from "@univerjs/preset-sheets-core/locales/ru-RU";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import dataValidationRu from "@univerjs/preset-sheets-data-validation/locales/ru-RU";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import drawingRu from "@univerjs/preset-sheets-drawing/locales/ru-RU";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import filterRu from "@univerjs/preset-sheets-filter/locales/ru-RU";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import findReplaceRu from "@univerjs/preset-sheets-find-replace/locales/ru-RU";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import sortRu from "@univerjs/preset-sheets-sort/locales/ru-RU";
import {
  CommandType,
  IImageIoService,
  ImageSourceType,
  ImageUploadStatusType,
  LocaleType,
  createUniver,
  defaultTheme,
  mergeLocales,
  type IWorkbookData,
} from "@univerjs/presets";
import { useEffect, useRef, type RefObject } from "react";

import "@fontsource/montserrat/cyrillic-400.css";
import "@fontsource/montserrat/cyrillic-700.css";
import "@fontsource/montserrat/latin-400.css";
import "@fontsource/montserrat/latin-700.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";

export type SheetSnapshot = Partial<IWorkbookData>;

/** What the page can ask of a mounted editor. */
export type SheetEditorHandle = {
  /** The workbook as it is now, ready to store. */
  save: () => SheetSnapshot;
};

/**
 * The spreadsheet itself: the open part of Univer, mounted on the client only.
 *
 * `view` — for everyone: no toolbar, no selection, no copying. `edit` — the admin's editor.
 * The interface is dark like the site, but the grid keeps the colours exactly as they were set:
 * Univer's own dark mode inverts every cell colour, which would repaint imported tables.
 */
export function SheetEditor({
  documentId,
  snapshot,
  mode,
  onDirty,
  onSettled,
  handleRef,
}: {
  documentId: string;
  snapshot: SheetSnapshot;
  mode: "view" | "edit";
  /** Called when the workbook changed (not on selection or scrolling). */
  onDirty?: () => void;
  /** Called once the opened workbook has settled: from here on a change is the person's own. */
  onSettled?: () => void;
  handleRef?: RefObject<SheetEditorHandle | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editable = mode === "edit";

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.RU_RU,
      locales: {
        [LocaleType.RU_RU]: mergeLocales(
          coreRu,
          conditionalFormattingRu,
          dataValidationRu,
          drawingRu,
          filterRu,
          findReplaceRu,
          sortRu,
        ),
      },
      theme: defaultTheme,
      darkMode: true,
      presets: [
        UniverSheetsCorePreset({
          container,
          header: editable,
          toolbar: editable,
          formulaBar: editable,
          contextMenu: editable,
          footer: editable ? {} : { sheetBar: true, statisticBar: false, menus: false, zoomSlider: true, addSheetButtonConfig: { show: false } },
          customFontFamily: [{ value: "Montserrat", label: "Montserrat" }],
        }),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset(),
        UniverSheetsDrawingPreset({ allowImageSize: 10 * 1024 * 1024 }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        ...(editable ? [UniverSheetsFindReplacePreset()] : []),
      ],
    });

    // The render engine registers its colour service itself, past the override list, so the one
    // instance is adjusted in place before anything is drawn: theme tokens are still resolved,
    // explicit colours pass through untouched.
    const colors = univer.__getInjector().get(ICanvasColorService) as unknown as {
      _resolvedThemeColors: Map<string, string>;
      getRenderColor: (color: string) => string;
    };
    colors.getRenderColor = (color) => colors._resolvedThemeColors.get(color) ?? color;

    // Pictures go to the site's storage; the workbook keeps their address, not their bytes.
    const images = univer.__getInjector().get(IImageIoService);
    images.saveImage = async (file: File) => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/tables/${documentId}/images`, { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
        if (!res.ok || !data.id || !data.url) throw new Error(ImageUploadStatusType.ERROR_IMAGE);
        return {
          imageId: data.id,
          imageSourceType: ImageSourceType.URL,
          source: data.url,
          base64Cache: "",
          status: ImageUploadStatusType.SUCCUSS,
        };
      } finally {
        // The editor counts uploads in progress and waits for zero.
        images.setWaitCount(0);
      }
    };

    const workbook = univerAPI.createWorkbook({ ...snapshot, id: documentId });
    const disposables: { dispose: () => void }[] = [];
    if (handleRef) handleRef.current = { save: () => workbook.save() };

    if (editable) {
      // Opening a workbook runs mutations of its own; only what happens after that is an edit.
      let settled = false;
      const settle = setTimeout(() => {
        settled = true;
        onSettledRef.current?.();
      }, 1500);
      disposables.push({ dispose: () => clearTimeout(settle) });
      disposables.push(
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (settled && event.type === CommandType.MUTATION) onDirtyRef.current?.();
        }),
      );
    } else {
      workbook.setEditable(false);
      workbook.disableSelection();
      workbook.transparentSelection();
      disposables.push(
        univerAPI.addEvent(univerAPI.Event.BeforeClipboardChange, (params) => {
          params.cancel = true;
        }),
      );
    }

    let alive = true;
    void Promise.all(
      ["400", "700"].map((weight) => document.fonts.load(`${weight} 12px "Montserrat"`, "Aя")),
    ).then(() => {
      if (alive) window.dispatchEvent(new Event("resize"));
    });

    return () => {
      alive = false;
      if (handleRef) handleRef.current = null;
      for (const disposable of disposables) disposable.dispose();
      univerAPI.dispose();
    };
    // The editor is built once per mount: the parent remounts it (by key) for a new table, version or mode.
  }, []);

  return (
    <div
      ref={containerRef}
      className="sheet-host"
      data-mode={mode}
      onCopy={mode === "view" ? (event) => event.preventDefault() : undefined}
      onContextMenu={mode === "view" ? (event) => event.preventDefault() : undefined}
    />
  );
}
