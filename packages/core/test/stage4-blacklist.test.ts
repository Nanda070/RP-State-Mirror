import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, JobStatus, RecordStatus } from "@mirror/db";
import {
  closeIcBlacklistEntry,
  createIcBlacklistEntry,
  expireIcBlacklistEntries,
  findActiveIcBlacklist,
  getIcBlacklistByNumber,
  MODULE_JOB_TYPES,
  makeIcBlacklistEmbed,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.blacklist.test" } as const;
const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("ic blacklist", () => {
  it("issues system numbers, publishes job, and closes by number", async () => {
    const first = await createIcBlacklistEntry(
      {
        staticId: "391200",
        fullName: "Nanda Lawleit",
        reason: "Решение суда №FC-1000",
        forumLink: "https://forum.example/evidence/1",
        createdByDiscordId: "800",
      },
      context,
    );
    expect(first.number).toBe("BL-001");
    expect(first.status).toBe(RecordStatus.ACTIVE);
    expect(await findActiveIcBlacklist("391200")).not.toBeNull();

    const publishJobs = await prisma.job.findMany({
      where: { type: MODULE_JOB_TYPES.IC_BLACKLIST_PUBLISH, status: JobStatus.PENDING },
    });
    expect(publishJobs).toHaveLength(1);
    expect((publishJobs[0]!.payload as { entryId: string }).entryId).toBe(first.id);

    await expect(
      createIcBlacklistEntry(
        {
          staticId: "391200",
          fullName: "Nanda Lawleit",
          reason: "ещё раз",
          forumLink: "https://forum.example/2",
          createdByDiscordId: "800",
        },
        context,
      ),
    ).rejects.toThrow(/уже есть активная/);

    const closed = await closeIcBlacklistEntry(
      {
        number: "bl-001",
        closedByDiscordId: "801",
        closeReason: "Исполнено по суду",
      },
      context,
    );
    expect(closed.status).toBe(RecordStatus.CLOSED);
    expect(closed.closeReason).toBe("Исполнено по суду");
    expect(await findActiveIcBlacklist("391200")).toBeNull();
    expect(await getIcBlacklistByNumber("BL-001")).toMatchObject({ status: RecordStatus.CLOSED });

    const editJobs = await prisma.job.findMany({
      where: { type: MODULE_JOB_TYPES.IC_BLACKLIST_EDIT_CLOSED, status: JobStatus.PENDING },
    });
    expect(editJobs).toHaveLength(1);
  });

  it("expires by ttl when expiresAt is set", async () => {
    await createIcBlacklistEntry(
      {
        staticId: "BL-1",
        fullName: "Test Citizen",
        reason: "нарушение",
        forumLink: "https://forum.example/ttl",
        createdByDiscordId: "800",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      context,
    );
    expect(await expireIcBlacklistEntries(new Date())).toBe(0);
    expect(await expireIcBlacklistEntries(new Date(Date.now() + 2 * 86_400_000))).toBe(1);
    expect(await findActiveIcBlacklist("BL-1")).toBeNull();
  });

  it("builds publish embed with exact government shape", () => {
    const embed = makeIcBlacklistEmbed({
      actorUsername: "gov.officer",
      actorAvatarUrl: null,
      fio: "Nanda Lawleit",
      passport: "391200",
      reason: "Решение суда №FC-1000",
      forumLink: "https://forum.example/evidence/1",
      number: "BL-001",
      now: NOW,
    });
    expect(embed.color).toBe(15_158_332);
    expect(embed.title).toBe("Новый IC Черный Список от Правительства штата");
    expect(embed.author?.name).toBe("Издал ордер: gov.officer");
    expect(embed.description).toContain("**Имя Фамилия:** Nanda Lawleit");
    expect(embed.description).toContain("**Номер Паспорта:** 391200");
    expect(embed.description).toContain("**Причина:** Решение суда №FC-1000");
    expect(embed.description).toContain("**Доказательства:**");
    expect(embed.description).toContain("**Статус:** Активен");
    expect(embed.description).toContain("**Номер:** BL-001");
    expect(embed.footer?.text).toMatch(/^Бот Discord \|/);

    const closed = makeIcBlacklistEmbed({
      actorUsername: "gov.officer",
      fio: "Nanda Lawleit",
      passport: "391200",
      reason: "Решение суда №FC-1000",
      forumLink: "https://forum.example/evidence/1",
      number: "BL-001",
      closed: true,
      closeReason: "Снято",
      closedByUsername: "closer",
      now: NOW,
    });
    expect(closed.title).toBe("IC Черный Список снят Правительством штата");
    expect(closed.description).toContain("**Статус:** Снят");
    expect(closed.description).toContain("**Причина снятия:** Снято");
  });
});
