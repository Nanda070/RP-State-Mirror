import { readMediaFile, resolveShareLink } from "@mirror/core";

type RouteContext = { params: Promise<{ token: string }> };

/** The photo of a shared record: reachable only through a live link, never by file id. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  const card = await resolveShareLink(token);
  const media = card?.photoFileId ? await readMediaFile(card.photoFileId).catch(() => null) : null;
  if (!media) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(media.body), {
    headers: {
      "Content-Type": media.file.contentType,
      "Content-Length": String(media.body.byteLength),
      // Not cached by shared caches, and only briefly by the browser: revoking must take effect.
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
