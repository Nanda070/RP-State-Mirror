import { currentLegalVersion } from "@mirror/core";
import { LEGAL_VERSION } from "@/lib/legal";

export const dynamic = "force-dynamic";

/** Version of the legal texts now in force (public): the cookie notice re-appears when it changes. */
export async function GET() {
  try {
    return Response.json({ version: await currentLegalVersion(LEGAL_VERSION) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ version: LEGAL_VERSION });
  }
}
