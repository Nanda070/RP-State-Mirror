import { prisma } from "@mirror/db";

export const dynamic = "force-dynamic";

/** Liveness probe for the reverse proxy and deploy/update.sh: the site answers and reaches the database. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
