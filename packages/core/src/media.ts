import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { RecordStatus, prisma } from "@mirror/db";
import { randomUUID } from "node:crypto";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Only Discord attachment CDNs: user-supplied URLs must never make the bot fetch arbitrary hosts (SSRF). */
export const DISCORD_MEDIA_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export const IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export class MediaValidationError extends UserError {
  override name = "MediaValidationError";
}

export function assertDiscordMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaValidationError("Некорректная ссылка на вложение.");
  }
  if (url.protocol !== "https:" || !DISCORD_MEDIA_HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new MediaValidationError("Принимаются только вложения Discord.");
  }
  return url;
}

/** Reads a response body, aborting as soon as it exceeds `maxBytes` (never buffers more than the limit). */
export async function readBodyWithLimit(response: Response, maxBytes = MAX_MEDIA_BYTES): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new MediaValidationError("Файл превышает лимит 10 МБ.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MediaValidationError("Файл превышает лимит 10 МБ.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function storageClient() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("Хранилище файлов (S3) не настроено.");
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function storageBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Хранилище файлов (S3_BUCKET) не настроено.");
  return bucket;
}

export function mediaExtension(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export async function storeMediaFromUrl(
  url: string,
  metadata: { originalName: string; createdById?: string; allowedContentTypes?: ReadonlySet<string> },
  context: AuditContext,
) {
  const safeUrl = assertDiscordMediaUrl(url);
  const bucket = storageBucket();
  const response = await fetch(safeUrl, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Не удалось скачать вложение: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "application/octet-stream";
  if (metadata.allowedContentTypes && !metadata.allowedContentTypes.has(contentType)) {
    await response.body?.cancel();
    throw new MediaValidationError("Недопустимый тип файла: нужно изображение PNG, JPEG, WEBP или GIF.");
  }
  const body = await readBodyWithLimit(response);
  return putMediaObject(bucket, body, contentType, metadata, context);
}

/** Detects the real image type from magic bytes; a client-declared content type is never trusted. */
export function sniffImageContentType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** Stores an image uploaded through the dashboard. The type comes from the bytes, not from the request. */
export async function storeUploadedImage(
  bytes: Uint8Array,
  metadata: { originalName: string; createdById?: string },
  context: AuditContext,
) {
  if (bytes.byteLength === 0) throw new MediaValidationError("Файл пустой.");
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaValidationError("Файл превышает лимит 10 МБ.");
  const contentType = sniffImageContentType(bytes);
  if (!contentType) throw new MediaValidationError("Недопустимый тип файла: нужно изображение PNG, JPEG, WEBP или GIF.");
  return putMediaObject(storageBucket(), bytes, contentType, metadata, context);
}

async function putMediaObject(
  bucket: string,
  body: Uint8Array,
  contentType: string,
  metadata: { originalName: string; createdById?: string },
  context: AuditContext,
) {
  const objectKey = `media/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${metadata.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
  await storageClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType }),
  );

  return auditedMutation(context, "media_file.created", "media_file", async (tx) => {
    const file = await tx.mediaFile.create({
      data: {
        objectKey,
        originalName: metadata.originalName.slice(0, 255),
        contentType,
        sizeBytes: body.byteLength,
        createdById: metadata.createdById ?? null,
      },
    });
    return { entityId: file.id, after: file, result: file };
  });
}

/** Loads an ACTIVE media file's bytes from S3 (e.g. to re-attach it to a Discord message). */
export async function readMediaFile(id: string) {
  const file = await prisma.mediaFile.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
  if (!file) return null;
  const object = await storageClient().send(new GetObjectCommand({ Bucket: storageBucket(), Key: file.objectKey }));
  if (!object.Body) throw new Error(`Пустой объект хранилища для ${id}`);
  const body = Buffer.from(await object.Body.transformToByteArray());
  return { file, body, attachmentName: `${file.id}.${mediaExtension(file.contentType)}` };
}

export async function archiveMediaFile(id: string, context: AuditContext) {
  return auditedMutation(context, "media_file.archived", "media_file", async (tx) => {
    const current = await tx.mediaFile.findUnique({ where: { id } });
    if (!current || current.status !== "ACTIVE") throw new Error("Медиафайл не найден или уже архивирован.");
    const updated = await tx.mediaFile.update({ where: { id }, data: { status: "ARCHIVED" } });
    return { entityId: id, before: current, after: updated, result: updated };
  });
}
