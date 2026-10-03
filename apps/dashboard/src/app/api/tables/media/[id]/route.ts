import { LOCKDOWN_MESSAGE, isSheetImage, readMediaFile } from "@mirror/core";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { isLockedOut, publicLockedOut } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A picture from a table, for everyone — tables are public. Only files tied to an active table
 * are handed out here; every other stored file stays behind `/api/media`.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await auth();
    if (session?.user ? await isLockedOut(session.identity) : await publicLockedOut()) {
      return Response.json({ error: LOCKDOWN_MESSAGE }, { status: 503 });
    }
    const { id } = await params;
    if (!(await isSheetImage(id))) return Response.json({ error: "Файл не найден" }, { status: 404 });
    const media = await readMediaFile(id);
    if (!media) return Response.json({ error: "Файл не найден" }, { status: 404 });
    return new Response(new Uint8Array(media.body), {
      headers: {
        "Content-Type": media.file.contentType,
        "Content-Length": String(media.body.byteLength),
        // Files are immutable: a new upload gets a new id.
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
