import type { TicketAttachment } from "@/components/feedback-attachments";

type FileInfo = { id: string; originalName: string; contentType: string; sizeBytes: number; status: string };

/** The files of one ticket message that still exist (an erased file is not shown). */
export function ticketFiles(ids: readonly string[], info: ReadonlyMap<string, FileInfo>): TicketAttachment[] {
  return ids.flatMap((id) => {
    const file = info.get(id);
    if (!file || file.status !== "ACTIVE") return [];
    return [{ id, name: file.originalName, contentType: file.contentType, size: file.sizeBytes }];
  });
}
