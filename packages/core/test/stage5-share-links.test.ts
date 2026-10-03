import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RecordStatus, RegistrationKind } from "@mirror/db";
import {
  ShareLinkError,
  closeWanted,
  createDocument,
  createFine,
  createIcBlacklistEntry,
  createShareLink,
  createWanted,
  listShareLinksFor,
  resolveShareLink,
  revokeShareLink,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.share.test" } as const;
const ADMIN = "840000000000000009";
const SECRET_LINK = "https://forum.example/secret-thread";

function share(entityType: Parameters<typeof createShareLink>[0]["entityType"], entityId: string) {
  return createShareLink({ entityType, entityId, createdByDiscordId: ADMIN }, context);
}

async function makeWanted() {
  return createWanted(
    {
      number: "W-1",
      characterName: "Ivan Petrov",
      staticId: "111",
      reason: "ст. 10",
      termText: "5 лет",
      forumLink: SECRET_LINK,
      issuedByDiscordId: ADMIN,
    },
    context,
  );
}

describe("share links", () => {
  it("gives one unguessable live link per record and reuses it", async () => {
    const wanted = await makeWanted();
    const first = await share("wanted", wanted.id);
    const again = await share("wanted", wanted.id);

    expect(first.token).toMatch(/^[\w-]{24}$/);
    expect(again.id).toBe(first.id);
    expect(await prisma.shareLink.count()).toBe(1);
    expect((await listShareLinksFor("wanted", [wanted.id, "other"])).get(wanted.id)).toEqual({
      id: first.id,
      token: first.token,
    });
    await expect(share("wanted", "missing")).rejects.toBeInstanceOf(ShareLinkError);
  });

  it("shows a brief card without Discord ids or forum links, and follows the record's status", async () => {
    const wanted = await makeWanted();
    const link = await share("wanted", wanted.id);

    const card = await resolveShareLink(link.token);
    expect(card).toMatchObject({ kind: "Федеральный розыск", title: "Ордер W-1", status: { label: "В розыске" } });
    const text = JSON.stringify(card);
    expect(text).toContain("Ivan Petrov");
    expect(text).not.toContain(ADMIN);
    expect(text).not.toContain(SECRET_LINK);

    await closeWanted({ wantedNumber: "W-1", closedByDiscordId: ADMIN, evidence: SECRET_LINK }, context);
    const closed = await resolveShareLink(link.token);
    expect(closed?.status).toEqual({ label: "Исполнен", tone: "ok" });
    expect(JSON.stringify(closed)).not.toContain(SECRET_LINK);
  });

  it("stops resolving after revoke and allows a fresh link with a new token", async () => {
    const wanted = await makeWanted();
    const link = await share("wanted", wanted.id);
    await revokeShareLink(link.id, ADMIN, context);

    expect(await resolveShareLink(link.token)).toBeNull();
    expect((await listShareLinksFor("wanted", [wanted.id])).size).toBe(0);
    await expect(revokeShareLink(link.id, ADMIN, context)).rejects.toBeInstanceOf(ShareLinkError);

    const fresh = await share("wanted", wanted.id);
    expect(fresh.token).not.toBe(link.token);
    expect(await resolveShareLink(fresh.token)).not.toBeNull();
    expect(await prisma.shareLink.count({ where: { status: RecordStatus.REVOKED } })).toBe(1);
  });

  it("never resolves malformed or unknown tokens", async () => {
    for (const token of ["", "short", "a".repeat(24), "../../etc/passwd", "x".repeat(200)]) {
      expect(await resolveShareLink(token)).toBeNull();
    }
  });

  it("keeps tokens out of the audit log", async () => {
    const wanted = await makeWanted();
    const link = await share("wanted", wanted.id);
    await revokeShareLink(link.id, ADMIN, context);
    const audit = await prisma.auditLog.findMany({ where: { entityType: "share_link" } });
    expect(audit.map((e) => e.action).sort()).toEqual(["share_link.created", "share_link.revoked"]);
    expect(JSON.stringify(audit)).not.toContain(link.token);
  });

  it("builds cards for every registry and exposes a registration photo only when approved", async () => {
    const fine = await createFine(
      { number: "F-1", characterName: "Ivan", staticId: "111", reason: "ст. 1", amount: 1500, paymentDeadlineText: "24h", issuedByDiscordId: ADMIN, factionCode: "GOV" },
      context,
    );
    const doc = await createDocument(
      { number: "LSPD-1", factionCode: "LSPD", authorDiscordId: ADMIN, subject: "Тема", content: "Описание", notifiedPerson: "Шеф", forumLink: SECRET_LINK, leaderText: "л", deputyText: "з" },
      context,
    );
    const bl = await createIcBlacklistEntry(
      { staticId: "111", fullName: "Ivan Petrov", reason: "нарушение", forumLink: SECRET_LINK, createdByDiscordId: ADMIN },
      context,
    );
    const registration = await prisma.registration.create({
      data: {
        kind: RegistrationKind.VEHICLE,
        staticId: "111",
        applicantDiscordId: ADMIN,
        payload: { model: "Sultan" },
        plate: "A123AA",
        evidenceFileIds: ["photo-1"],
      },
    });

    const cards = await Promise.all([
      share("fine", fine.id).then((l) => resolveShareLink(l.token)),
      share("document", doc.id).then((l) => resolveShareLink(l.token)),
      share("ic_blacklist", bl.id).then((l) => resolveShareLink(l.token)),
    ]);
    expect(cards.map((c) => c?.title)).toEqual(["Штраф F-1", "Документ LSPD-1", "Запись BL-001"]);
    expect(cards[0]?.status.label).toBe("Не оплачен");
    for (const card of cards) {
      expect(JSON.stringify(card)).not.toContain(SECRET_LINK);
      expect(JSON.stringify(card)).not.toContain(ADMIN);
    }

    const regLink = await share("registration", registration.id);
    const pending = await resolveShareLink(regLink.token);
    expect(pending).toMatchObject({ title: "ТС A123AA", status: { label: "На рассмотрении" }, photoFileId: null });

    await prisma.registration.update({
      where: { id: registration.id },
      data: { decision: DecisionStatus.APPROVED, expiresAt: new Date("2026-11-03T12:00:00Z") },
    });
    const approved = await resolveShareLink(regLink.token);
    expect(approved).toMatchObject({ status: { label: "Действует" }, photoFileId: "photo-1" });
    expect(approved?.facts.map((f) => f.label)).toEqual(["Статик владельца", "Модель", "Госномер", "Действует до"]);
  });
});
