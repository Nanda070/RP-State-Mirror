import { DecisionStatus, RecordStatus, RegistrationKind, prisma, type Prisma } from "@mirror/db";

export type RegistrationListFilter = {
  kind: RegistrationKind;
  decision?: DecisionStatus;
  status?: RecordStatus;
  limit?: number;
  offset?: number;
};

export type RegistrationListItem = {
  id: string;
  kind: RegistrationKind;
  staticId: string;
  plate: string | null;
  modelOrDescription: string;
  decision: DecisionStatus;
  status: RecordStatus;
  displayStatus: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  applicantDiscordId: string;
  applicantLabel: string;
  rejectionReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  expiresAt: Date | null;
};

function payloadText(payload: Prisma.JsonValue, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "—";
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string") return "—";
  const text = value.trim();
  return text || "—";
}

export function registrationDisplayStatus(
  decision: DecisionStatus,
  status: RecordStatus,
): RegistrationListItem["displayStatus"] {
  if (status === RecordStatus.EXPIRED) return "EXPIRED";
  if (decision === DecisionStatus.REJECTED) return "REJECTED";
  if (decision === DecisionStatus.APPROVED) return "APPROVED";
  return "PENDING";
}

export const REGISTRATION_DISPLAY_STATUS_RU: Record<RegistrationListItem["displayStatus"], string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрено",
  REJECTED: "Отказано",
  EXPIRED: "Истекла",
};

export function registrationStatusTone(
  display: RegistrationListItem["displayStatus"],
): "ok" | "warn" | "muted" {
  if (display === "APPROVED") return "ok";
  if (display === "PENDING") return "warn";
  return "muted";
}

async function resolveApplicantLabels(discordIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(discordIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const members = await prisma.guildMember.findMany({
    where: { userDiscordId: { in: unique }, isPresent: true },
    select: { userDiscordId: true, nickname: true, globalName: true, username: true },
    orderBy: { updatedAt: "desc" },
  });
  const map = new Map<string, string>();
  for (const member of members) {
    if (map.has(member.userDiscordId)) continue;
    map.set(
      member.userDiscordId,
      member.nickname?.trim() || member.globalName?.trim() || member.username.trim() || member.userDiscordId,
    );
  }
  return map;
}

export async function listRegistrations(
  filter: RegistrationListFilter,
): Promise<{ total: number; items: RegistrationListItem[] }> {
  const where = {
    kind: filter.kind,
    ...(filter.decision ? { decision: filter.decision } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.registration.count({ where }),
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 100,
      skip: filter.offset ?? 0,
      select: {
        id: true,
        kind: true,
        staticId: true,
        plate: true,
        payload: true,
        decision: true,
        status: true,
        applicantDiscordId: true,
        rejectionReason: true,
        createdAt: true,
        decidedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const labels = await resolveApplicantLabels(rows.map((row) => row.applicantDiscordId));

  const items = rows.map((row) => {
    const displayStatus = registrationDisplayStatus(row.decision, row.status);
    const modelOrDescription =
      row.kind === RegistrationKind.VEHICLE
        ? payloadText(row.payload, "model")
        : payloadText(row.payload, "description");
    return {
      id: row.id,
      kind: row.kind,
      staticId: row.staticId,
      plate: row.plate,
      modelOrDescription,
      decision: row.decision,
      status: row.status,
      displayStatus,
      applicantDiscordId: row.applicantDiscordId,
      applicantLabel: labels.get(row.applicantDiscordId) ?? row.applicantDiscordId,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      expiresAt: row.expiresAt,
    };
  });

  return { total, items };
}
