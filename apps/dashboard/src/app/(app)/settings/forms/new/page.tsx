import { getSetting } from "@mirror/core";
import { prisma } from "@mirror/db";
import { FormBuilder } from "@/components/form-builder";
import { getActiveChannelOptions } from "@/lib/catalog";
import { emptyFormBuilderValue } from "@/lib/forms";
import { turnstileSiteKey } from "@/lib/public-request";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Новая форма" };

export default async function NewFormPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  await requireSystemSettingsPage();
  const { request } = await searchParams;
  // A form requested through /создать-вебхук starts with that webhook. The URL is a secret, so it is
  // looked up here by request id instead of travelling in the address bar.
  const [channels, publicBaseUrl, webhookRequest] = await Promise.all([
    getActiveChannelOptions(),
    getSetting("app.publicBaseUrl"),
    typeof request === "string" && request
      ? prisma.webhookRequest.findUnique({ where: { id: request }, select: { webhookUrl: true, description: true } })
      : null,
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Новая форма</h1>
        <p className="muted">
          Одна форма работает и в Discord (кнопка открывает окно ввода), и на сайте (публичная страница без
          входа).
        </p>
        {webhookRequest ? (
          <p className="muted">
            Запрос сотрудника: «{webhookRequest.description}». Вебхук из запроса уже подставлен.
          </p>
        ) : null}
      </div>
      <FormBuilder
        initial={emptyFormBuilderValue(webhookRequest?.webhookUrl ?? "")}
        captchaConfigured={turnstileSiteKey() !== null}
        publicBaseUrl={publicBaseUrl}
        channels={channels.map((channel) => ({
          discordId: channel.discordId,
          name: channel.name,
          guildDiscordId: channel.guild.discordId,
          guildName: channel.guild.name,
        }))}
      />
    </div>
  );
}
