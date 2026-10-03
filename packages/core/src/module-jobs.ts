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
  TRANSFER_DECIDED: "transfer.decided",
  ROLE_PANEL_PUBLISH: "role_panel.publish",
  ROLE_PANEL_ARCHIVE: "role_panel.archive",
  FEEDBACK_TICKET_NOTIFY: "feedback.ticket_notify",
  FEEDBACK_REPLY_SEND: "feedback.reply_send",
  FEEDBACK_CLOSED_SEND: "feedback.closed_send",
  FEEDBACK_OPEN_PUBLISH: "feedback.open_publish",
  FORM_SUBMISSION_DELIVER: "form.submission_deliver",
  FORM_OPEN_PUBLISH: "form.open_publish",
  TOKEN_RECEIVE_PUBLISH: "token.receive_publish",
  WEBHOOK_REQUEST_NOTIFY: "webhook_request.notify",
  IC_BLACKLIST_PUBLISH: "ic_blacklist.publish",
  IC_BLACKLIST_EDIT_CLOSED: "ic_blacklist.edit_closed",
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

export function enqueueRolePanelPublish(rolePanelId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.ROLE_PANEL_PUBLISH, payload: { rolePanelId } },
    db,
  );
}

export function enqueueRolePanelArchive(rolePanelId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.ROLE_PANEL_ARCHIVE, payload: { rolePanelId } },
    db,
  );
}

export function enqueueFeedbackTicketNotify(ticketId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.FEEDBACK_TICKET_NOTIFY, payload: { ticketId } },
    db,
  );
}

export function enqueueFeedbackReplySend(
  payload: { ticketId: string; messageId: string },
  db?: Db,
) {
  return enqueueJob({ type: MODULE_JOB_TYPES.FEEDBACK_REPLY_SEND, payload }, db);
}

export function enqueueFeedbackClosedSend(ticketId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.FEEDBACK_CLOSED_SEND, payload: { ticketId } },
    db,
  );
}

export function enqueueFeedbackOpenPublish(
  payload: { guildDiscordId: string; channelDiscordId: string },
  db?: Db,
) {
  return enqueueJob({ type: MODULE_JOB_TYPES.FEEDBACK_OPEN_PUBLISH, payload }, db);
}

export function enqueueFormSubmissionDeliver(submissionId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.FORM_SUBMISSION_DELIVER, payload: { submissionId } },
    db,
  );
}

export function enqueueFormOpenPublish(
  payload: { formId: string; guildDiscordId: string; channelDiscordId: string },
  db?: Db,
) {
  return enqueueJob({ type: MODULE_JOB_TYPES.FORM_OPEN_PUBLISH, payload }, db);
}

export function enqueueTokenReceivePublish(
  payload: {
    guildDiscordId: string;
    channelDiscordId: string;
    messageText?: string | null;
  },
  db?: Db,
) {
  return enqueueJob({ type: MODULE_JOB_TYPES.TOKEN_RECEIVE_PUBLISH, payload }, db);
}

export function enqueueWebhookRequestNotify(requestId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.WEBHOOK_REQUEST_NOTIFY, payload: { requestId } },
    db,
  );
}

export function enqueueIcBlacklistPublish(entryId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.IC_BLACKLIST_PUBLISH, payload: { entryId } },
    db,
  );
}

export function enqueueIcBlacklistEditClosed(entryId: string, db?: Db) {
  return enqueueJob(
    { type: MODULE_JOB_TYPES.IC_BLACKLIST_EDIT_CLOSED, payload: { entryId } },
    db,
  );
}

