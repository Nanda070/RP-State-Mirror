/**
 * Facts the legal pages state. The operator's name and contacts come from the environment, so the
 * texts name a real party without the code knowing who deploys it.
 *
 * LEGAL_VERSION changes whenever the meaning of a text changes: the cookie notice is shown again
 * and the pages show the new date.
 */
export const LEGAL_VERSION = "2026-10-03";
export const LEGAL_VERSION_RU = "3 октября 2026 года";

export function legalOperator() {
  return {
    /** Who runs the service: a person or an organisation. */
    name: process.env.LEGAL_OPERATOR_NAME?.trim() || "администрация проекта Mirror · GTA5RP",
    /** Address for requests about data and about these terms. */
    email: process.env.LEGAL_CONTACT_EMAIL?.trim() || null,
    /** Law that governs the terms, as a phrase: «законодательство Российской Федерации». */
    law: process.env.LEGAL_GOVERNING_LAW?.trim() || null,
  };
}
