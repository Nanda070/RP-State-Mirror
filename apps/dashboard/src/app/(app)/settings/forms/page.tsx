import { isDiscordCompatible, listForms } from "@mirror/core";
import Link from "next/link";
import { DiscordFormsManager } from "@/components/discord-forms-manager";
import { getDashboardEnv } from "@/env";
import { getActiveChannelOptions, getActiveGuildOptions } from "@/lib/catalog";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Формы" };

export default async function SettingsFormsPage() {
  await requireSystemSettingsPage();

  const [forms, channels, guilds] = await Promise.all([
    listForms(),
    getActiveChannelOptions(),
    getActiveGuildOptions(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Формы</h1>
        <p className="muted">
          Конструктор форм: поля разных типов, заполнение в Discord (кнопка открывает окно ввода, длинные
          формы — в несколько шагов) и на публичной странице без входа. Ответы приходят в канал и/или webhook
          и сохраняются здесь.
        </p>
      </div>
      <div className="row">
        <Link href="/settings/webhooks" className="btn btn-secondary">
          Запросы форм от игроков
        </Link>
      </div>
      <DiscordFormsManager
        publicBaseUrl={getDashboardEnv().PUBLIC_BASE_URL}
        initialForms={forms.map((form) => ({
          id: form.id,
          name: form.name,
          status: form.status,
          webhookUrl: form.webhookUrl,
          deliveryChannelId: form.deliveryChannelId,
          openGuildDiscordId: form.openGuildDiscordId,
          openChannelDiscordId: form.openChannelDiscordId,
          openMessageDiscordId: form.openMessageDiscordId,
          slug: form.slug,
          publicEnabled: form.publicEnabled,
          discordCompatible: isDiscordCompatible(form.fields),
          fields: form.fields.map((field) => ({ key: field.key, label: field.label })),
          _count: form._count,
        }))}
        guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
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
