/**
 * Job type constants and enqueue helpers for Stage 3 Discord delivery.
 */
import { enqueueJob } from "./jobs.js";
import type { Db } from "./db.js";

export const MODULE_JOB_TYPES = {
  DOCUMENT_SEND: "document.send",
  DOCUMENT_RESPONSE_SEND: "document.response.send",
  WANTED_PUBLISH: "wanted.publish",
  WANTED_EDIT_CLOSED: "wanted.edit_closed",
  FINE_PUBLISH: "fine.publish",
  FINE_EDIT_PAID: "fine.edit_paid",
  PERSONNEL_PUBLISH: "personnel.publish",
  MESSAGE_DESIGN_SEND: "message_design.send",
  MESSAGE_DESIGN_RESEND: "message_design.resend",
  REGISTRATION_REVIEW: "registration.review",
  REGISTRATION_DECIDED: "registration.decided",
  REGISTRATION_EXPIRED: "registration.expired",
  TRANSFER_REVIEW: "transfer.review",
} as const;

export type ModuleJobType = (typeof MODULE_JOB_TYPES)[keyof typeof MODULE_JOB_TYPES];

export function enqueueDocumentSend(documentId: string, db?: Db) {
  return enqueueJob({ type: MODULE_JOB_TYPES.DOCUMENT_SEND, payload: { documentId } }, db);
}

export function enqueueDocumentResponseSend(
  responseId: string,
  documentId: string,
  options?: { sourceGuildDiscordId?: string | null; db?: Db },
) {
  const db = options?.db;
  const sourceGuildDiscordId = options?.sourceGuildDiscordId ?? null;
  return enqueueJob(
    {
      type: MODULE_JOB_TYPES.DOCUMENT_RESPONSE_SEND,
      payload: {
        responseId,
        documentId,
        ...(sourceGuildDiscordId ? { sourceGuildDiscordId } : {}),
      },
    },
    db,
  );
}

export function enqueueWantedPublish(wantedId: string, db?: Db) {
  return enqueueJob({ type: MODULE_JOB_TYPES.WANTED_PUBLISH, payload: { wantedId } }, db);
}

export function enqueueWantedEditClosed(wantedId: string, db?: Db) {
  return enqueueJob({ type: MODULE_JOB_TYPES.WANTED_EDIT_CLOSED, payload: { wantedId } }, db);
}

export function enqueueFinePublish(fineId: string, db?: Db) {
  return enqueueJob({ type: MODULE_JOB_TYPES.FINE_PUBLISH, payload: { fineId } }, db);
}

export function enqueueFineEditPaid(fineId: string, db?: Db) {
  return enqueueJob({ type: MODULE_JOB_TYPES.FINE_EDIT_PAID, payload: { fineId } }, db);
}

export function enqueuePersonnelPublish(personnelEventId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.PERSONNEL_PUBLISH, payload: { personnelEventId } },
    db,
  );
}
