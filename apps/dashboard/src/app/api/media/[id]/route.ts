import {
  LOCKDOWN_MESSAGE,
  canViewModules,
  isOwnFeedbackAttachment,
  isVehicleCatalogImage,
  readMediaFile,
} from "@mirror/core";
import { auth } from "@/auth";
import { jsonError } from "@/lib/api";
import { AuthRequiredError, ForbiddenError, publicLockedOut, requireIdentity } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Serves a stored image through the dashboard, so storage URLs and keys never reach the browser.
 * Catalog photos are readable by anyone, ticket files by the ticket's author;
 * every other file needs staff access.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await auth();
    if (!session?.user?.discordId) {
      // The catalog is open to guests, so its photos are too; nothing else is.
      if (await publicLockedOut()) return Response.json({ error: LOCKDOWN_MESSAGE }, { status: 503 });
      if (!(await isVehicleCatalogImage(id))) throw new AuthRequiredError("Требуется вход через Discord");
    } else {
      const { identity } = await requireIdentity();
      if (
        !canViewModules(identity) &&
        !(await isVehicleCatalogImage(id)) &&
        !(await isOwnFeedbackAttachment(id, identity.discordUserId))
      ) {
        throw new ForbiddenError("Нет доступа к файлу");
      }
    }
    const media = await readMediaFile(id);
    if (!media) return Response.json({ error: "Файл не найден" }, { status: 404 });
    return new Response(new Uint8Array(media.body), {
      headers: {
        "Content-Type": media.file.contentType,
        "Content-Length": String(media.body.byteLength),
        // Files are immutable (a new upload gets a new id); `private` keeps them out of shared caches.
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        // A PDF is downloaded, never rendered on the site's origin; pictures open in place.
        "Content-Disposition": media.file.contentType.startsWith("image/")
          ? "inline"
          : `attachment; filename="${media.attachmentName}"; filename*=UTF-8''${encodeURIComponent(media.file.originalName)}`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
