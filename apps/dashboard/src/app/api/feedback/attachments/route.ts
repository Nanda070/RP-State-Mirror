import {
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_MEDIA_BYTES,
  MediaValidationError,
  UserError,
  storeUploadedAttachment,
} from "@mirror/core";
import { jsonError } from "@/lib/api";
import { dashboardAuditContext } from "@/lib/audit-context";
import { requireIdentity } from "@/lib/session";

/**
 * Files for a ticket message («Мои обращения» and the staff inbox): pictures and PDF, up to
 * 10 MB each. The files are stored first; the message then lists their ids, and only the
 * uploader can attach them (see `checkFeedbackAttachments`).
 */
export async function POST(request: Request) {
  try {
    const { session } = await requireIdentity();
    const form = await request.formData();
    const files = form.getAll("file").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length === 0) throw new MediaValidationError("Файл не выбран.");
    if (files.length > MAX_FEEDBACK_ATTACHMENTS) {
      throw new UserError(`Можно прикрепить не больше ${MAX_FEEDBACK_ATTACHMENTS} файлов к одному сообщению.`);
    }
    // Reject by declared size before buffering; the stored size is re-checked from the bytes.
    if (files.some((file) => file.size > MAX_MEDIA_BYTES)) throw new MediaValidationError("Файл превышает лимит 10 МБ.");
    const context = await dashboardAuditContext(session.user.id);
    const stored = [];
    for (const file of files) {
      const media = await storeUploadedAttachment(
        new Uint8Array(await file.arrayBuffer()),
        { originalName: file.name || "file", createdById: session.user.id },
        context,
      );
      stored.push({ id: media.id, name: media.originalName, contentType: media.contentType, size: media.sizeBytes });
    }
    return Response.json({ files: stored });
  } catch (error) {
    return jsonError(error);
  }
}
