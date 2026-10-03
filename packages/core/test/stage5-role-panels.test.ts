import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  RolePanelError,
  buildRolePanelSpec,
  createRolePanelFromInput,
  embedSpecSchema,
  isButtonPanelSpec,
  materializeEmbedSpecButtons,
  parseCustomId,
  republishRolePanel,
  stripButtonComponents,
  type RolePanelInput,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.role-panels.test" } as const;
const GUILD = "850000000000000001";
const CHANNEL = "850000000000000010";
const ADMIN = "850000000000000099";
const ROLES = ["850000000000000101", "850000000000000102", "850000000000000103"] as const;
const MANAGED = "850000000000000199";

function input(overrides: Partial<RolePanelInput> = {}): RolePanelInput {
  return {
    guildDiscordId: GUILD,
    channelDiscordId: CHANNEL,
    title: "Выберите отдел",
    mode: "buttons",
    items: ROLES.map((roleDiscordId, index) => ({ label: `Отдел ${index + 1}`, roleDiscordId })),
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
  const guild = await prisma.guild.create({ data: { discordId: GUILD, name: "FIB" } });
  await prisma.discordChannel.create({ data: { discordId: CHANNEL, guildId: guild.id, name: "roles", type: 0, position: 0 } });
  await prisma.discordRole.createMany({
    data: [
      ...ROLES.map((discordId, position) => ({ discordId, guildId: guild.id, name: `R${position}`, color: 0, position, managed: false })),
      { discordId: MANAGED, guildId: guild.id, name: "Bot role", color: 0, position: 9, managed: true },
      { discordId: GUILD, guildId: guild.id, name: "@everyone", color: 0, position: 0, managed: false },
    ],
  });
});
afterAll(() => prisma.$disconnect());

describe("role panel spec", () => {
  it("builds toggle buttons, five per row, with restrictions and exclusivity", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      label: `Роль ${index}`,
      roleDiscordId: `8500000000000002${String(index).padStart(2, "0")}`,
    }));
    const spec = buildRolePanelSpec(input({ items, exclusive: true, allowedRoleIds: [ROLES[0]] }));
    expect(embedSpecSchema.safeParse(spec).success).toBe(true);
    if (spec.version !== 1) throw new Error("expected v1");
    expect(spec.components?.map((row) => (row.type === "action_row" ? row.components.length : -1))).toEqual([5, 2]);
    const first = spec.components?.[0];
    if (first?.type !== "action_row") throw new Error("expected buttons");
    expect(first.components[0]).toMatchObject({
      action: "role.toggle",
      params: {
        roleDiscordId: items[0]?.roleDiscordId,
        allowedRoleIds: [ROLES[0]],
        exclusiveRoleIds: items.map((item) => item.roleDiscordId),
      },
    });
    expect(isButtonPanelSpec(spec)).toBe(true);
  });

  it("builds a dropdown whose limit follows the exclusive flag", () => {
    const many = buildRolePanelSpec(input({ mode: "select" }));
    const one = buildRolePanelSpec(input({ mode: "select", exclusive: true, placeholder: "Ваш отдел" }));
    if (many.version !== 1 || one.version !== 1) throw new Error("expected v1");
    expect(many.components?.[0]).toMatchObject({ type: "role_select", maxValues: 3, placeholder: "Выберите роли" });
    expect(one.components?.[0]).toMatchObject({ type: "role_select", maxValues: 1, placeholder: "Ваш отдел" });
    expect(many.components?.[0]).not.toHaveProperty("allowedRoleIds");
    expect(stripButtonComponents(many)).not.toHaveProperty("components");
  });

  it("gives the dropdown a persistent id that stores its roles, and keeps it on re-publish", async () => {
    const spec = buildRolePanelSpec(input({ mode: "select", exclusive: true, allowedRoleIds: [ROLES[2]] }));
    const ready = await materializeEmbedSpecButtons(spec);
    if (ready.version !== 1) throw new Error("expected v1");
    const select = ready.components?.[0];
    if (select?.type !== "role_select" || !select.customId) throw new Error("expected materialized select");

    const parsed = parseCustomId(select.customId);
    expect(parsed?.action).toBe("role.select");
    const stored = await prisma.buttonAction.findUniqueOrThrow({ where: { id: parsed?.id ?? "" } });
    expect(stored.params).toEqual({ roleIds: [...ROLES], allowedRoleIds: [ROLES[2]], maxValues: 1 });

    const again = await materializeEmbedSpecButtons(ready);
    expect(again).toEqual(ready);
    expect(await prisma.buttonAction.count()).toBe(1);
  });

  it("rejects duplicate roles and empty panels", () => {
    expect(() => buildRolePanelSpec(input({ items: [] }))).toThrow(/хотя бы одну роль/);
    expect(() =>
      buildRolePanelSpec(input({ items: [{ label: "A", roleDiscordId: ROLES[0] }, { label: "B", roleDiscordId: ROLES[0] }] })),
    ).toThrow(/дважды/);
  });
});

describe("role panel creation", () => {
  it("creates the panel, queues publication and can re-publish it", async () => {
    const panel = await createRolePanelFromInput(input(), ADMIN, context);
    expect(panel).toMatchObject({ guildDiscordId: GUILD, channelDiscordId: CHANNEL, createdByDiscordId: ADMIN });
    await republishRolePanel(panel.id, context);
    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.ROLE_PANEL_PUBLISH } });
    expect(jobs.map((job) => job.payload)).toEqual([{ rolePanelId: panel.id }, { rolePanelId: panel.id }]);
    await expect(republishRolePanel("missing", context)).rejects.toBeInstanceOf(RolePanelError);
  });

  it("checks the guild, channel and roles against the Discord snapshot", async () => {
    const cases: Array<[Partial<RolePanelInput>, RegExp]> = [
      [{ guildDiscordId: "850000000000000002" }, /Сервер не найден/],
      [{ channelDiscordId: "850000000000000011" }, /Канал не найден/],
      [{ items: [{ label: "X", roleDiscordId: "850000000000000777" }] }, /ролей не найдена/],
      [{ allowedRoleIds: ["850000000000000777"] }, /ролей не найдена/],
      [{ items: [{ label: "Bot", roleDiscordId: MANAGED }] }, /управляется интеграцией/],
      [{ items: [{ label: "All", roleDiscordId: GUILD }] }, /@everyone/],
    ];
    for (const [overrides, message] of cases) {
      await expect(createRolePanelFromInput(input(overrides), ADMIN, context)).rejects.toThrow(message);
    }
    expect(await prisma.rolePanel.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });
});

describe("role dropdown schema", () => {
  it("accepts real Discord role ids and rejects anything else", async () => {
    const { embedSpecSchema } = await import("@mirror/core");
    const spec = (roleDiscordId: string) => ({
      version: 1 as const,
      embeds: [{ type: "embed" as const, title: "Роли" }],
      components: [{ type: "role_select" as const, options: [{ label: "Отдел", roleDiscordId }] }],
    });
    // A panel is validated with this schema right before the bot publishes it.
    expect(embedSpecSchema.safeParse(spec("890000000000000300")).success).toBe(true);
    expect(embedSpecSchema.safeParse(spec("dddddddddddddddddd")).success).toBe(false);
    expect(embedSpecSchema.safeParse(spec("123")).success).toBe(false);
  });
});
