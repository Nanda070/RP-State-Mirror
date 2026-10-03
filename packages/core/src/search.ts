/**
 * Global search of the dashboard (PLAN §5.7): one query string against every registry.
 * Results are links to the registry page already filtered by that string, plus the best matches
 * themselves, so a number or a static typed into Ctrl+K lands on the record.
 */
import { RegistrationKind, prisma } from "@mirror/db";

export interface SearchHit {
  /** Registry the hit belongs to, as a short Russian label. */
  kind: string;
  title: string;
  detail: string;
  href: string;
}

const PER_REGISTRY = 4;
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });
const link = (path: string, q: string) => `${path}?q=${encodeURIComponent(q)}`;

/**
 * `staff` — «Хелпер» and above: sees every registry. Everyone else searches only what any signed-in
 * user may open (the IC blacklist).
 */
export async function searchRecords(query: string, access: { staff: boolean }): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const take = PER_REGISTRY;

  const blacklist = prisma.icBlacklistEntry.findMany({
    where: { OR: [{ number: contains(q) }, { staticId: contains(q) }, { fullName: contains(q) }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { number: true, fullName: true, staticId: true },
  });
  if (!access.staff) {
    return (await blacklist).map((row) => ({
      kind: "IC ЧС",
      title: `${row.number} · ${row.fullName}`,
      detail: `паспорт ${row.staticId}`,
      href: link("/ic-blacklist", row.number),
    }));
  }

  const [entries, wanted, fines, documents, characters, registrations, transfers] = await Promise.all([
    blacklist,
    prisma.wanted.findMany({
      where: { OR: [{ number: contains(q) }, { staticId: contains(q) }, { characterName: contains(q) }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { number: true, characterName: true, staticId: true },
    }),
    prisma.fine.findMany({
      where: { OR: [{ number: contains(q) }, { staticId: contains(q) }, { characterName: contains(q) }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { number: true, characterName: true, staticId: true },
    }),
    prisma.document.findMany({
      where: { OR: [{ number: contains(q) }, { subject: contains(q) }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { number: true, subject: true, factionCode: true },
    }),
    prisma.character.findMany({
      where: {
        OR: [
          { staticId: contains(q) },
          { name: contains(q) },
          { user: { discordId: contains(q) } },
          { tokens: { some: { number: contains(q) } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { name: true, staticId: true, factionCode: true },
    }),
    prisma.registration.findMany({
      where: { OR: [{ staticId: contains(q) }, { plate: contains(q) }, { applicantDiscordId: contains(q) }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { kind: true, staticId: true, plate: true },
    }),
    prisma.transfer.findMany({
      where: { OR: [{ character: { staticId: contains(q) } }, { character: { name: contains(q) } }] },
      orderBy: { createdAt: "desc" },
      take,
      select: { fromFactionCode: true, toFactionCode: true, character: { select: { name: true, staticId: true } } },
    }),
  ]);

  return [
    ...characters.map((row) => ({
      kind: "Персонаж",
      title: row.name,
      detail: [`статик ${row.staticId}`, row.factionCode].filter(Boolean).join(" · "),
      href: link("/tokens", row.staticId),
    })),
    ...wanted.map((row) => ({
      kind: "Розыск",
      title: `${row.number} · ${row.characterName}`,
      detail: `паспорт ${row.staticId}`,
      href: link("/wanted", row.number),
    })),
    ...fines.map((row) => ({
      kind: "Штраф",
      title: `${row.number} · ${row.characterName}`,
      detail: `паспорт ${row.staticId}`,
      href: link("/fines", row.number),
    })),
    ...documents.map((row) => ({
      kind: "Документ",
      title: `${row.number} · ${row.factionCode}`,
      detail: row.subject.slice(0, 80),
      href: link("/documents", row.number),
    })),
    ...registrations.map((row) => ({
      kind: row.kind === RegistrationKind.VEHICLE ? "Регистрация ТС" : "Регистрация формы",
      title: row.plate ? `${row.plate} · статик ${row.staticId}` : `статик ${row.staticId}`,
      detail: "",
      href: link(row.kind === RegistrationKind.VEHICLE ? "/registrations/vehicles" : "/registrations/uniforms", row.plate ?? row.staticId),
    })),
    ...transfers.map((row) => ({
      kind: "Перевод",
      title: `${row.character.name} · ${row.fromFactionCode} → ${row.toFactionCode}`,
      detail: `статик ${row.character.staticId}`,
      href: link("/transfers", row.character.staticId),
    })),
    ...entries.map((row) => ({
      kind: "IC ЧС",
      title: `${row.number} · ${row.fullName}`,
      detail: `паспорт ${row.staticId}`,
      href: link("/ic-blacklist", row.number),
    })),
  ];
}
