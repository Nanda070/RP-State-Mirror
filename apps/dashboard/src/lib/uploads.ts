import { MAX_MEDIA_BYTES, MediaValidationError, storeUploadedImage, type AuditContext } from "@mirror/core";

/**
 * Reads an optional image from multipart form data and stores it in S3.
 * Returns `undefined` when the field is absent or empty (no file chosen).
 */
export async function storeImageField(
  form: FormData,
  field: string,
  createdById: string,
  context: AuditContext,
): Promise<string | undefined> {
  const value = form.get(field);
  if (!(value instanceof File) || value.size === 0) return undefined;
  // Reject by declared size before buffering; the stored size is re-checked from the bytes.
  if (value.size > MAX_MEDIA_BYTES) throw new MediaValidationError("Файл превышает лимит 10 МБ.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  const file = await storeUploadedImage(bytes, { originalName: value.name || "upload", createdById }, context);
  return file.id;
}

export function formText(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  return typeof value === "string" ? value : undefined;
}
