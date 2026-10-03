"use client";

import Link from "next/link";
import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { GuildChipPicker, RoleChipPicker, type RoleChipOption } from "./role-chip-picker";
import { ToggleRow } from "./toggle-row";

export type Stage4SettingsValues = {
  "registrations.ttlDays": number;
  "registrations.vehicleChannelId": string | null;
  "registrations.uniformChannelId": string | null;
  "registrations.coordinatorRoleIds": string[];
  "transfers.channelId": string | null;
  "transfers.approvalDmText": string;
  "webhooks.notifyChannelId": string | null;
  "feedback.notifyChannelId": string | null;
  "icBlacklist.enabled": boolean;
  "icBlacklist.channelId": string | null;
  "icBlacklist.managerRoleIds": string[];
  "icBlacklist.searchRoleIds": string[];
  "invites.guildIds": string[];
  "invites.defaultMaxAgeSeconds": number;
  "tokens.expandThresholdPercent": number;
  "tokens.finderRoleIds": string[];
};

type TabId =
  | "registrations"
  | "transfers"
  | "icBlacklist"
  | "tokens"
  | "webhooks"
  | "feedback"
  | "invites";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "registrations", label: "Регистрации" },
  { id: "transfers", label: "Переводы" },
  { id: "icBlacklist", label: "IC ЧС" },
  { id: "tokens", label: "Токены" },
  { id: "webhooks", label: "Webhooks" },
  { id: "feedback", label: "Обратная связь" },
  { id: "invites", label: "Инвайты" },
];

export function Stage4SettingsManager({
  initial,
  initialTab = "registrations",
  channels,
  incidentRoles,
  govRoles,
  guilds,
  incidentGuildId,
  govGuildId,
}: {
  initial: Stage4SettingsValues;
  initialTab?: TabId;
  channels: ChannelOption[];
  incidentRoles: RoleChipOption[];
  govRoles: RoleChipOption[];
  guilds: Array<{ discordId: string; name: string }>;
  incidentGuildId: string | null;
  govGuildId: string | null;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function patch<K extends keyof Stage4SettingsValues>(key: K, value: Stage4SettingsValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/stage4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            ...values,
            "registrations.vehicleChannelId": values["registrations.vehicleChannelId"] || null,
            "registrations.uniformChannelId": values["registrations.uniformChannelId"] || null,
            "transfers.channelId": values["transfers.channelId"] || null,
            "webhooks.notifyChannelId": values["webhooks.notifyChannelId"] || null,
            "feedback.notifyChannelId": values["feedback.notifyChannelId"] || null,
            "icBlacklist.channelId": values["icBlacklist.channelId"] || null,
          },
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Ошибка сохранения");
      setMessage("Настройки сохранены.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  }

  const channelEmpty = incidentGuildId ? "Выберите канал" : "Сначала задайте сервер ЧП";
  const incidentRolesEmpty = incidentGuildId
    ? "Нет ролей сервера ЧП в снимке. Дождитесь синхронизации бота."
    : "Сначала задайте сервер ЧП";
  const govRoleIds = new Set(govRoles.map((role) => role.discordId));
  const finderRoles: RoleChipOption[] = [
    ...govRoles.map((role) => ({ ...role, group: "GOV" })),
    ...incidentRoles
      .filter((role) => !govRoleIds.has(role.discordId))
      .map((role) => ({ ...role, group: "ЧП" })),
  ];
  const finderRolesEmpty =
    !govGuildId && !incidentGuildId
      ? "Сначала привяжите сервер GOV к фракции и задайте сервер ЧП"
      : !govGuildId
        ? "Сначала привяжите сервер GOV к фракции"
        : !incidentGuildId
          ? "Сначала задайте сервер ЧП"
          : "Нет ролей GOV/ЧП в снимке. Дождитесь синхронизации бота.";

  return (
    <div className="stack">
      <div className="settings-tabs" role="tablist" aria-label="Разделы модулей">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="settings-tab"
            aria-selected={tab === item.id}
            data-active={tab === item.id || undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel stack">
        {tab === "registrations" ? (
          <>
            <h2 className="panel-title">Регистрации ТС и униформы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Подать заявку могут все. Каналы ТС и формы раздельные; координаторы общие — одобряют и
              получают пинг в обоих каналах. Реестры — в{" "}
              <Link href="/registrations/vehicles" className="stub-link">
                Информация → Регистрации ТС
              </Link>{" "}
              и{" "}
              <Link href="/registrations/uniforms" className="stub-link">
                Регистрации форм
              </Link>
              .
            </p>
            <label className="field">
              <span>Срок действия, дней</span>
              <input
                type="number"
                min={1}
                step={1}
                value={values["registrations.ttlDays"]}
                onChange={(e) => patch("registrations.ttlDays", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Канал регистрации ТС</span>
              <ChannelSelect
                id="registrations-vehicle-channel"
                value={values["registrations.vehicleChannelId"] ?? ""}
                onChange={(v) => patch("registrations.vehicleChannelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
            <label className="field">
              <span>Канал регистрации формы (униформы)</span>
              <ChannelSelect
                id="registrations-uniform-channel"
                value={values["registrations.uniformChannelId"] ?? ""}
                onChange={(v) => patch("registrations.uniformChannelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
            <div className="field">
              <span className="field-label">Координаторы регистраций</span>
              <RoleChipPicker
                roles={incidentRoles}
                selected={values["registrations.coordinatorRoleIds"]}
                onChange={(next) => patch("registrations.coordinatorRoleIds", next)}
                emptyHint={incidentRolesEmpty}
              />
            </div>
          </>
        ) : null}

        {tab === "transfers" ? (
          <>
            <h2 className="panel-title">Переводы</h2>
            <label className="field">
              <span>Канал переводов</span>
              <ChannelSelect
                id="transfers-channel"
                value={values["transfers.channelId"] ?? ""}
                onChange={(v) => patch("transfers.channelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
            <label className="field">
              <span>Текст ЛС после одобрения</span>
              <textarea
                value={values["transfers.approvalDmText"]}
                onChange={(e) => patch("transfers.approvalDmText", e.target.value)}
                rows={4}
              />
            </label>
          </>
        ) : null}

        {tab === "icBlacklist" ? (
          <>
            <h2 className="panel-title">IC чёрный список — настройки</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Реестр записей — в разделе{" "}
              <Link href="/ic-blacklist" className="stub-link">
                Информация → IC ЧС реестр
              </Link>
              .
            </p>
            <ToggleRow
              id="ic-blacklist-enabled"
              checked={values["icBlacklist.enabled"]}
              onChange={(checked) => patch("icBlacklist.enabled", checked)}
              label="Модуль IC ЧС включён"
            />
            <label className="field">
              <span>Канал публикации</span>
              <ChannelSelect
                id="ic-blacklist-channel"
                value={values["icBlacklist.channelId"] ?? ""}
                onChange={(v) => patch("icBlacklist.channelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
            <div className="field">
              <span className="field-label">Роли управления ЧС</span>
              <RoleChipPicker
                roles={incidentRoles}
                selected={values["icBlacklist.managerRoleIds"]}
                onChange={(next) => patch("icBlacklist.managerRoleIds", next)}
                emptyHint={incidentRolesEmpty}
              />
            </div>
            <div className="field">
              <span className="field-label">Роли поиска ЧС</span>
              <RoleChipPicker
                roles={incidentRoles}
                selected={values["icBlacklist.searchRoleIds"]}
                onChange={(next) => patch("icBlacklist.searchRoleIds", next)}
                emptyHint={incidentRolesEmpty}
              />
            </div>
          </>
        ) : null}

        {tab === "tokens" ? (
          <>
            <h2 className="panel-title">Токены и нашивки</h2>
            <label className="field">
              <span>Порог расширения наших, %</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={values["tokens.expandThresholdPercent"]}
                onChange={(e) => patch("tokens.expandThresholdPercent", Number(e.target.value))}
              />
            </label>
            <div className="field">
              <span className="field-label">Роли /token find</span>
              <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.85rem" }}>
                Роли серверов GOV и ЧП, которым разрешён поиск нашивок.
              </p>
              <RoleChipPicker
                roles={finderRoles}
                selected={values["tokens.finderRoleIds"]}
                onChange={(next) => patch("tokens.finderRoleIds", next)}
                emptyHint={finderRolesEmpty}
              />
            </div>
          </>
        ) : null}

        {tab === "webhooks" ? (
          <>
            <h2 className="panel-title">Webhooks — уведомления</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Очередь запросов и создание форм — в{" "}
              <Link href="/settings/webhooks" className="stub-link">
                Администрирование → Webhooks
              </Link>
              .
            </p>
            <label className="field">
              <span>Канал уведомлений о запросах</span>
              <ChannelSelect
                id="webhooks-notify"
                value={values["webhooks.notifyChannelId"] ?? ""}
                onChange={(v) => patch("webhooks.notifyChannelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
          </>
        ) : null}

        {tab === "feedback" ? (
          <>
            <h2 className="panel-title">Обратная связь — уведомления</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Тикеты игроков — в{" "}
              <Link href="/feedback" className="stub-link">
                Администрирование → Обратная связь
              </Link>
              .
            </p>
            <label className="field">
              <span>Канал уведомлений</span>
              <ChannelSelect
                id="feedback-notify"
                value={values["feedback.notifyChannelId"] ?? ""}
                onChange={(v) => patch("feedback.notifyChannelId", v || null)}
                channels={channels}
                guildDiscordId={incidentGuildId}
                emptyLabel={channelEmpty}
              />
            </label>
          </>
        ) : null}

        {tab === "invites" ? (
          <>
            <h2 className="panel-title">Инвайты</h2>
            <label className="field">
              <span>Срок инвайта по умолчанию, сек</span>
              <input
                type="number"
                min={60}
                max={604800}
                step={1}
                value={values["invites.defaultMaxAgeSeconds"]}
                onChange={(e) => patch("invites.defaultMaxAgeSeconds", Number(e.target.value))}
              />
            </label>
            <div className="field">
              <span className="field-label">Серверы команды /инвайт-админ</span>
              <GuildChipPicker
                guilds={guilds}
                selected={values["invites.guildIds"]}
                onChange={(next) => patch("invites.guildIds", next)}
                emptyHint="Нет синхронизированных серверов."
              />
            </div>
          </>
        ) : null}

        <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void save()}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
        {message ? (
          <p className="muted" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
