import { canManageModules, canManageSystemSettings, canViewModules, getBotHeartbeat, isHeartbeatFresh } from "@mirror/core";
import { DecisionStatus, FeedbackTicketStatus, JobStatus, RecordStatus, TransferStatus, prisma } from "@mirror/db";
import { jsonError } from "@/lib/api";
import { requireIdentity } from "@/lib/session";

export const dynamic = "force-dynamic";

type Notice = { key: string; text: string; href: string; count: number; tone: "warn" | "bad" };

/**
 * What waits for the signed-in user, counted from the registries. Each role sees its own list:
 * a player — own unpaid fines; staff — applications and tickets; the super admin — failed jobs
 * and a silent bot.
 */
export async function GET() {
  try {
    const { session, identity } = await requireIdentity();
    const notices: Notice[] = [];
    const add = (notice: Notice) => {
      if (notice.count > 0) notices.push(notice);
    };

    const statics = (
      await prisma.character.findMany({
        where: { user: { discordId: session.user.discordId }, status: RecordStatus.ACTIVE },
        select: { staticId: true },
      })
    ).map((character) => character.staticId);
    if (statics.length > 0) {
      add({
        key: "own-fines",
        text: "неоплаченных штрафов у ваших персонажей",
        href: "/profile?tab=records",
        count: await prisma.fine.count({ where: { staticId: { in: statics }, status: RecordStatus.ACTIVE } }),
        tone: "warn",
      });
    }

    if (canManageModules(identity)) {
      const pending = { decision: DecisionStatus.PENDING, status: RecordStatus.ACTIVE };
      const [vehicles, uniforms, transfers] = await Promise.all([
        prisma.registration.count({ where: { ...pending, kind: "VEHICLE" } }),
        prisma.registration.count({ where: { ...pending, kind: "UNIFORM" } }),
        prisma.transfer.count({ where: { status: TransferStatus.PENDING } }),
      ]);
      add({ key: "vehicles", text: "заявок на регистрацию ТС ждут решения", href: "/registrations/vehicles?status=PENDING", count: vehicles, tone: "warn" });
      add({ key: "uniforms", text: "заявок на регистрацию формы ждут решения", href: "/registrations/uniforms?status=PENDING", count: uniforms, tone: "warn" });
      add({ key: "transfers", text: "переводов на рассмотрении", href: "/transfers?status=PENDING", count: transfers, tone: "warn" });
    }

    if (canViewModules(identity)) {
      add({
        key: "feedback",
        text: "открытых обращений",
        href: "/feedback",
        count: await prisma.feedbackTicket.count({
          where: { status: { in: [FeedbackTicketStatus.OPEN, FeedbackTicketStatus.IN_PROGRESS] } },
        }),
        tone: "warn",
      });
    }

    if (canManageSystemSettings(identity)) {
      add({
        key: "jobs",
        text: "задач упало за сутки",
        href: "/jobs?status=FAILED",
        count: await prisma.job.count({
          where: { status: JobStatus.FAILED, updatedAt: { gte: new Date(Date.now() - 86_400_000) } },
        }),
        tone: "bad",
      });
      const heartbeat = await getBotHeartbeat();
      if (heartbeat && !isHeartbeatFresh(heartbeat.at)) {
        notices.unshift({ key: "bot", text: "бот не отвечает", href: "/status", count: 1, tone: "bad" });
      }
    }

    return Response.json({ notices }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
