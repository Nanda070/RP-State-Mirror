"use client";

import { useState } from "react";
import { ChannelSelect, type ChannelOption } from "./channel-select";
import { GuildChipPicker, RoleChipPicker, type RoleChipOption } from "./role-chip-picker";
import { ToggleRow } from "./toggle-row";
import { TokenReceivePublish } from "./token-receive-publish";

export type Stage4SettingsValues = {
  "registrations.ttlDays": number;
  "registrations.pendingTtlDays": number;
  "registrations.vehicleChannelId": string | null;
  "registrations.uniformChannelId": string | null;
  "registrations.coordinatorRoleIds": string[];
  "transfers.channelId": string | null;
  "transfers.pingRoleIds": string[];
  "transfers.approvalDmText": string;
  "transfers.pendingTtlDays": number;
  "vehicleRequests.channelId": string | null;
  "vehicleRequests.pingRoleIds": string[];
  "vehicleRequests.requesterRoleIds": string[];
  "webhooks.notifyChannelId": string | null;
  "feedback.notifyChannelId": string | null;
  "feedback.categories": string[];
  "icBlacklist.enabled": boolean;
  "icBlacklist.channelId": string | null;
  "icBlacklist.managerRoleIds": string[];
  "icBlacklist.searchRoleIds": string[];
  "invites.guildIds": string[];
  "invites.defaultMaxAgeSeconds": number;
  "tokens.expandThresholdPercent": number;
  "tokens.finderRoleIds": string[];
};

export type ModuleTabId =
  | "registrations"
  | "transfers"
  | "icBlacklist"
  | "tokens"
  | "vehicleRequests"
  | "webhooks"
  | "feedback"
  | "invites";

export function Stage4SettingsManager({
  initial,
  tab,
  channels,
  incidentRoles,
  govRoles,
  allRoles,
  guilds,
  incidentGuildId,
  govGuildId,
  tokenOpenMessage = null,
}: {
  initial: Stage4SettingsValues;
  /** Which module's settings to show; the strip of tabs belongs to the page. */
  tab: ModuleTabId;
  channels: ChannelOption[];
  incidentRoles: RoleChipOption[];
  govRoles: RoleChipOption[];
  /** Roles of every connected server: a module that is not tied to the ЧП server picks from its own. */
  allRoles: Array<RoleChipOption & { guildDiscordId: string }>;
  guilds: Array<{ discordId: string; name: string }>;
  incidentGuildId: string | null;
  govGuildId: string | null;
  tokenOpenMessage?: {
    guildDiscordId: string;
    channelDiscordId: string;
    messageDiscordId: string;
  } | null;
}) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** «Запрос ТС»: the server whose roles are being chosen. */
  const [requesterGuildId, setRequesterGuildId] = useState(guilds[0]?.discordId ?? "");

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
            "vehicleRequests.channelId": values["vehicleRequests.channelId"] || null,
            "webhooks.notifyChannelId": values["webhooks.notifyChannelId"] || null,
            "feedback.notifyChannelId": values["feedback.notifyChannelId"] || null,
            "feedback.categories": (values["feedback.categories"] ?? []).map((line) => line.trim()).filter(Boolean),
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
  const vehicleRequestGuildId = channels.find((channel) => channel.discordId === values["vehicleRequests.channelId"])?.guildDiscordId;
  const vehicleRequestRoles = vehicleRequestGuildId ? allRoles.filter((role) => role.guildDiscordId === vehicleRequestGuildId) : [];
  const requesterChosen = new Set(values["vehicleRequests.requesterRoleIds"]);
  const requesterRoles = allRoles.filter((role) => role.guildDiscordId === requesterGuildId);
  const requesterCount = (guildDiscordId: string) =>
    allRoles.filter((role) => role.guildDiscordId === guildDiscordId && requesterChosen.has(role.discordId)).length;
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
      <section className="panel stack">
        {tab === "registrations" ? (
          <>
            <h2 className="panel-title">Регистрации ТС и униформы</h2>
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
              <span>Закрывать нерассмотренную заявку через, дней</span>
              <input
                type="number"
                min={1}
                step={1}
                value={values["registrations.pendingTtlDays"]}
                onChange={(e) => patch("registrations.pendingTtlDays", Number(e.target.value))}
              />
              <span className="field-hint">
                Заявка, по которой никто не принял решение, закрывается сама: статик освобождается, заявитель
                получает сообщение.
              </span>
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
            <div className="field">
              <span className="field-label">Кого тегать при заявке на перевод</span>
              <p className="muted u-m0 u-mb1 u-text-sm">
                Только роли сервера ЧП. В заявке тегаются выбранные роли, которые есть в снимке ЧП
                (чужие id пропускаются, без @unknown-role).
              </p>
              <RoleChipPicker
                roles={incidentRoles}
                selected={values["transfers.pingRoleIds"]}
                onChange={(next) => patch("transfers.pingRoleIds", next)}
                emptyHint={incidentRolesEmpty}
              />
            </div>
            <label className="field">
              <span>Текст ЛС после одобрения</span>
              <textarea
                value={values["transfers.approvalDmText"]}
                onChange={(e) => patch("transfers.approvalDmText", e.target.value)}
                rows={4}
              />
            </label>
            <label className="field">
              <span>Закрывать нерассмотренную заявку через, дней</span>
              <input
                type="number"
                min={1}
                step={1}
                value={values["transfers.pendingTtlDays"]}
                onChange={(e) => patch("transfers.pendingTtlDays", Number(e.target.value))}
              />
            </label>
          </>
        ) : null}

        {tab === "icBlacklist" ? (
          <>
            <h2 className="panel-title">IC чёрный список — настройки</h2>
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
              <span className="field-label">Роли /нашивка найти</span>
              <p className="muted u-m0 u-mb1 u-text-sm">
                Роли серверов GOV и ЧП, которым разрешён поиск нашивок.
              </p>
              <RoleChipPicker
                roles={finderRoles}
                selected={values["tokens.finderRoleIds"]}
                onChange={(next) => patch("tokens.finderRoleIds", next)}
                emptyHint={finderRolesEmpty}
              />
            </div>
            <hr className="u-rule" />
            <TokenReceivePublish
              guilds={guilds}
              channels={channels}
              initialOpenMessage={tokenOpenMessage}
            />
          </>
        ) : null}

        {tab === "vehicleRequests" ? (
          <>
            <h2 className="panel-title">Запрос ТС — куда приходит</h2>
            <label className="field">
              <span>Канал</span>
              <ChannelSelect
                id="vehicle-requests-channel"
                value={values["vehicleRequests.channelId"] ?? ""}
                onChange={(next) => {
                  // Roles are mentioned on the channel's own server: a change of server drops the old choice.
                  const guildOf = (id: string) => channels.find((channel) => channel.discordId === id)?.guildDiscordId;
                  if (guildOf(next) !== guildOf(values["vehicleRequests.channelId"] ?? "")) patch("vehicleRequests.pingRoleIds", []);
                  patch("vehicleRequests.channelId", next || null);
                }}
                channels={channels}
                emptyLabel="Выберите канал"
              />
            </label>
            <div className="field">
              <span className="field-label">Кого упоминать</span>
              <RoleChipPicker
                roles={vehicleRequestRoles}
                selected={values["vehicleRequests.pingRoleIds"]}
                onChange={(next) => patch("vehicleRequests.pingRoleIds", next)}
                emptyHint={values["vehicleRequests.channelId"] ? "У сервера этого канала нет ролей в снимке." : "Сначала выберите канал."}
              />
            </div>

            <hr className="u-rule" />
            <h2 className="panel-title">Запрос ТС — кто может запрашивать</h2>
            <label className="field">
              <span>Сервер</span>
              <select value={requesterGuildId} onChange={(event) => setRequesterGuildId(event.target.value)}>
                {guilds.map((guild) => {
                  const count = requesterCount(guild.discordId);
                  return (
                    <option key={guild.discordId} value={guild.discordId}>
                      {count > 0 ? `${guild.name} — ролей: ${count}` : guild.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Роли этого сервера</span>
              <RoleChipPicker
                roles={requesterRoles}
                selected={values["vehicleRequests.requesterRoleIds"]}
                onChange={(next) => patch("vehicleRequests.requesterRoleIds", next)}
                emptyHint="У этого сервера нет ролей в снимке."
              />
              <span className="field-hint">Без выбранных ролей на сервере фракции запросить может любой его участник.</span>
            </div>
          </>
        ) : null}

        {tab === "webhooks" ? (
          <>
            <h2 className="panel-title">Вебхуки — уведомления</h2>
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
            <label className="field">
              <span>Категории обращений — по одной в строке</span>
              <textarea
                rows={5}
                value={(values["feedback.categories"] ?? []).join("\n")}
                onChange={(event) =>
                  patch(
                    "feedback.categories",
                    event.target.value.split("\n").map((line) => line.trimStart()),
                  )
                }
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
