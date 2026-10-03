import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { auditedMutation, type AuditContext } from "./audit.js";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

function storageClient() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("S3 storage is not configured.");
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function storeMediaFromUrl(
  url: string,
  metadata: { originalName: string; createdById?: string },
  context: AuditContext,
) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not configured.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось скачать вложение: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream";
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_MEDIA_BYTES) throw new Error("Файл превышает лимит 10 МБ.");

  const objectKey = `media/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${metadata.originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await storageClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType }),
  );

  return auditedMutation(context, "media_file.created", "media_file", async (tx) => {
    const file = await tx.mediaFile.create({
      data: {
        objectKey,
        originalName: metadata.originalName,
        contentType,
        sizeBytes: body.byteLength,
        createdById: metadata.createdById ?? null,
      },
    });
    return { entityId: file.id, after: file, result: file };
  });
}

export async function archiveMediaFile(id: string, context: AuditContext) {
  return auditedMutation(context, "media_file.archived", "media_file", async (tx) => {
    const current = await tx.mediaFile.findUnique({ where: { id } });
    if (!current || current.status !== "ACTIVE") throw new Error("Медиафайл не найден или уже архивирован.");
    const updated = await tx.mediaFile.update({ where: { id }, data: { status: "ARCHIVED" } });
    return { entityId: id, before: current, after: updated, result: updated };
  });
}
