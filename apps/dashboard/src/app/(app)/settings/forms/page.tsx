import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { DiscordFormsManager } from "@/components/discord-forms-manager";
import { getActiveChannelOptions } from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsFormsPage({
  searchParams,
}: {
  searchParams?: Promise<{ webhookUrl?: string }>;
}) {
  await requireSystemSettingsPage();
  const params = searchParams ? await searchParams : {};
  const initialWebhookUrl =
    typeof params.webhookUrl === "string" && params.webhookUrl.startsWith("https://")
      ? params.webhookUrl
      : "";

  const [forms, channels] = await Promise.all([
    prisma.discordForm.findMany({
      where: { status: RecordStatus.ACTIVE },
      include: {
        fields: { orderBy: { position: "asc" }, select: { key: true, label: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    getActiveChannelOptions(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Discord-формы</h1>
        <p className="muted">
          Создание и просмотр modal-форм Discord. Доставка ответов — в канал и/или webhook.
        </p>
        <div className="status-link-row">
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/settings/webhooks" className="stub-link">
            К webhooks
          </Link>
        </div>
      </div>
      <DiscordFormsManager
        initialForms={forms}
        initialWebhookUrl={initialWebhookUrl}
        channels={channels.map((c) => ({
          discordId: c.discordId,
          name: c.name,
          guildDiscordId: c.guild.discordId,
          guildName: c.guild.name,
        }))}
      />
    </div>
  );
}
