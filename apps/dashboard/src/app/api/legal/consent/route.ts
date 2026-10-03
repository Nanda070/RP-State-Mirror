import { currentLegalVersion, recordLegalConsent } from "@mirror/core";
import { jsonError } from "@/lib/api";
import { LEGAL_VERSION } from "@/lib/legal";
import { requireSession } from "@/lib/session";

/** The signed-in user accepts the current edition of the terms. */
export async function POST() {
  try {
    const session = await requireSession();
    const version = await currentLegalVersion(LEGAL_VERSION);
    await recordLegalConsent(session.user.discordId, version);
    return Response.json({ ok: true, version });
  } catch (error) {
    return jsonError(error);
  }
}
