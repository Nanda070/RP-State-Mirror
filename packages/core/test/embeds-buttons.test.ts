import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
import {
  checkDiscordLimits,
  createMessageDesign,
  isButtonPanelSpec,
  makeCustomId,
  materializeEmbedSpecButtons,
  parseCustomId,
  seedFoundation,
  stripButtonComponents,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const ctx = { actorType: AuditActorType.SYSTEM, source: "test" } as const;

describe("embed buttons + designs", () => {
  it("parses mirror custom ids", () => {
    const id = makeCustomId("role.toggle", "abc123");
    expect(id).toBe("mirror:role.toggle:abc123");
    expect(parseCustomId(id)).toEqual({ action: "role.toggle", id: "abc123" });
    expect(parseCustomId("other:x:y")).toBeNull();
  });

  it("classifies button panels vs embed-only specs", () => {
    expect(
      isButtonPanelSpec({
        version: 1,
        embeds: [{ type: "embed", title: "A" }],
      }),
    ).toBe(false);
    expect(
      isButtonPanelSpec({
        version: 1,
        embeds: [{ type: "embed", title: "A" }],
        components: [],
      }),
    ).toBe(true);
    expect(
      stripButtonComponents({
        version: 1,
        embeds: [{ type: "embed", title: "A" }],
        components: [{ type: "action_row", components: [] }],
      }),
    ).toEqual({
      version: 1,
      embeds: [{ type: "embed", title: "A" }],
    });
  });

  it("materializes role.toggle buttons into persisted button_actions", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const spec = {
      version: 1 as const,
      embeds: [{ type: "embed" as const, title: "Роли", description: "Нажмите кнопку" }],
      components: [
        {
          type: "action_row" as const,
          components: [
            {
              type: "button" as const,
              label: "LSPD",
              style: "primary" as const,
              action: "role.toggle" as const,
              params: { roleDiscordId: "111111111111111111" },
            },
          ],
        },
      ],
    };

    const ready = await materializeEmbedSpecButtons(spec);
    expect(ready.version).toBe(1);
    if (ready.version !== 1) return;
    const row = ready.components?.[0];
    const btn = row?.type === "action_row" ? row.components[0] : undefined;
    expect(btn?.customId?.startsWith("mirror:role.toggle:")).toBe(true);
    expect(btn?.action).toBeUndefined();
    expect(await prisma.buttonAction.count()).toBe(1);
  });

  it("materializes form.open / feedback.open / token.receive buttons", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const spec = {
      version: 1 as const,
      embeds: [{ type: "embed" as const, title: "Модули" }],
      components: [
        {
          type: "action_row" as const,
          components: [
            {
              type: "button" as const,
              label: "Форма",
              style: "primary" as const,
              action: "form.open" as const,
              params: { formId: "form1" },
            },
            {
              type: "button" as const,
              label: "Фидбек",
              style: "secondary" as const,
              action: "feedback.open" as const,
              params: {},
            },
            {
              type: "button" as const,
              label: "Нашивка",
              style: "success" as const,
              action: "token.receive" as const,
              params: {},
            },
          ],
        },
      ],
    };
    const ready = await materializeEmbedSpecButtons(spec);
    expect(ready.version).toBe(1);
    if (ready.version !== 1) return;
    const row = ready.components?.[0];
    const labels = (row?.type === "action_row" ? row.components : []).map((b) => b.customId?.split(":")[1]);
    expect(labels).toEqual(["form.open", "feedback.open", "token.receive"]);
    expect(await prisma.buttonAction.count()).toBe(3);
  });

  it("creates audited message designs", async () => {
    await seedFoundation({ superAdminUserIds: [] });
    const design = await createMessageDesign(
      {
        name: "Приветствие",
        spec: {
          version: 1,
          embeds: [{ type: "embed", title: "Hi", color: 0xff6a1a }],
        },
      },
      ctx,
    );
    expect(design.name).toBe("Приветствие");
    expect(checkDiscordLimits(design.spec as never)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: "message_design.created" } })).toBe(1);
  });
});

describe("template variables", () => {
  it("fills placeholders safely and leaves unknown ones as written", async () => {
    const { extractVariables, substituteVariables } = await import("@mirror/core");
    const spec = {
      version: 1 as const,
      embeds: [{ type: "embed" as const, title: "Привет, {name}", description: "Сервер {server}. {unknown}" }],
    };
    expect(extractVariables(spec)).toEqual(["name", "server", "unknown"]);

    // Quotes, backslashes and line breaks in a value must not break the message.
    const filled = substituteVariables(spec, { name: 'Иван "Ваня" \ Петров\nвторая строка', server: "Mirror" });
    expect(filled).toEqual({
      version: 1,
      embeds: [
        { type: "embed", title: 'Привет, Иван "Ваня" \ Петров\nвторая строка', description: "Сервер Mirror. {unknown}" },
      ],
    });
  });
});
