import { getFormForEdit } from "@mirror/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormBuilder } from "@/components/form-builder";
import { getDashboardEnv } from "@/env";
import { getActiveChannelOptions, getActiveRoleOptions } from "@/lib/catalog";
import { toFormBuilderValue } from "@/lib/forms";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Редактирование формы" };

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSystemSettingsPage();
  const { id } = await params;
  const [form, channels, roles] = await Promise.all([getFormForEdit(id), getActiveChannelOptions(), getActiveRoleOptions()]);
  if (!form) notFound();

  return (
    <div className="stack">
      <div className="section-head">
        <h1>{form.name}</h1>
        <p className="muted">
          Ответов: {form._count.submissions.toLocaleString("ru-RU")} ·{" "}
          <Link href={`/settings/forms/${form.id}/responses`}>смотреть ответы</Link>. Убранные поля уходят в
          архив — уже полученные ответы сохраняют свои подписи.
        </p>
      </div>
      <FormBuilder
        initial={toFormBuilderValue(form)}
        publicBaseUrl={getDashboardEnv().PUBLIC_BASE_URL}
        channels={channels.map((channel) => ({
          discordId: channel.discordId,
          name: channel.name,
          guildDiscordId: channel.guild.discordId,
          guildName: channel.guild.name,
        }))}
        roles={roles.map((role) => ({ discordId: role.discordId, name: role.name, guildDiscordId: role.guild.discordId }))}
      />
    </div>
  );
}
