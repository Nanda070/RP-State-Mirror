"use client";

import { useId, useRef, useState } from "react";

/** A file attached to a ticket message, as the thread shows it. */
export type TicketAttachment = { id: string; name: string; contentType: string; size: number };

/** Mirrors MAX_FEEDBACK_ATTACHMENTS in the core (the server checks it again). */
export const MAX_TICKET_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

/** Uploads the chosen files; the message then carries their ids. */
export async function uploadTicketFiles(files: readonly File[]): Promise<TicketAttachment[]> {
  if (files.length === 0) return [];
  const form = new FormData();
  for (const file of files) form.append("file", file);
  const res = await fetch("/api/feedback/attachments", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string; files?: TicketAttachment[] };
  if (!res.ok || !data.files) throw new Error(data.error ?? "Не удалось загрузить файл. Попробуйте позже.");
  return data.files;
}

/** «Прикрепить файл»: pictures and PDF, up to five, 10 MB each; checked here before anything is sent. */
export function AttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`«${file.name}» больше 10 МБ.`);
        continue;
      }
      if (!ACCEPT.split(",").includes(file.type)) {
        setError(`«${file.name}»: можно прикрепить только изображение или PDF.`);
        continue;
      }
      next.push(file);
    }
    if (next.length > MAX_TICKET_FILES) setError(`Не больше ${MAX_TICKET_FILES} файлов к одному сообщению.`);
    else if (next.length === files.length + list.length) setError(null);
    onChange(next.slice(0, MAX_TICKET_FILES));
    if (input.current) input.current.value = "";
  }

  return (
    <div className="attach-picker">
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        disabled={disabled || files.length >= MAX_TICKET_FILES}
        onChange={(event) => add(event.target.files)}
      />
      <label
        htmlFor={inputId}
        className="btn btn-ghost attach-button"
        aria-disabled={disabled || files.length >= MAX_TICKET_FILES ? true : undefined}
      >
        📎 Прикрепить файл
      </label>
      {files.length > 0 ? (
        <ul className="attach-chips">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="attach-chip">
              <span className="attach-name">{file.name}</span>
              <span className="muted">{formatSize(file.size)}</span>
              <button
                type="button"
                className="attach-remove"
                aria-label={`Убрать ${file.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, at) => at !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

/** Files of one message: pictures as thumbnails, PDF as a download link. */
export function AttachmentList({ files }: { files: readonly TicketAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="attach-list">
      {files.map((file) =>
        file.contentType.startsWith("image/") ? (
          <li key={file.id}>
            <a href={`/api/media/${file.id}`} target="_blank" rel="noreferrer" className="attach-thumb" title={file.name}>
              <img src={`/api/media/${file.id}`} alt={file.name} loading="lazy" />
            </a>
          </li>
        ) : (
          <li key={file.id}>
            <a href={`/api/media/${file.id}`} className="attach-chip attach-file" download={file.name}>
              <span aria-hidden>📄</span>
              <span className="attach-name">{file.name}</span>
              <span className="muted">{formatSize(file.size)}</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
