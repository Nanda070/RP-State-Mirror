import {
  DM_KINDS,
  PERSONNEL_EVENT_LABELS_RU,
  buildStatusBadge,
  formatMoney,
  getMutedDmKinds,
  getPlayerProfile,
  getSetting,
  listAuditLogPage,
  listSessionsForUser,
  type PlayerProfile,
} from "@mirror/core";
import { RecordStatus, RegistrationKind, prisma } from "@mirror/db";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { DmPreferencesForm } from "@/components/dm-preferences-form";
import { SessionsList } from "@/components/sessions-list";
import { getFactionColors } from "@/lib/catalog";
import { formatMoscow, formatMoscowShort } from "@/lib/moscow";
import { toSessionRows } from "@/lib/session-rows";
import {
  REGISTRATION_DISPLAY_STATUS_RU,
  registrationDisplayStatus,
  registrationStatusTone,
} from "@/lib/registrations";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";
import { FactionBadge, Money, Plate, WantedStars, factionStyle } from "@/components/ui";

const TABS = [
  { key: "overview", label: "Обзор" },
  { key: "characters", label: "Персонажи и нашивки" },
  { key: "registrations", label: "Регистрации и переводы" },
  { key: "records", label: "Штрафы и розыск" },
  { key: "servers", label: "Фракции и серверы" },
  { key: "history", label: "История" },
  { key: "notifications", label: "Уведомления" },
  { key: "sessions", label: "Сессии" },
] as const;

export const metadata = { title: "Профиль" };

/** Discord account badges by bit of the public flags. */
const DISCORD_BADGES: [number, string][] = [
  [0, "Сотрудник Discord"],
  [1, "Партнёр Discord"],
  [2, "HypeSquad Events"],
  [3, "Bug Hunter"],
  [6, "HypeSquad Bravery"],
  [7, "HypeSquad Brilliance"],
  [8, "HypeSquad Balance"],
  [9, "Ранний сторонник"],
  [14, "Bug Hunter II"],
  [17, "Ранний разработчик ботов"],
  [18, "Модератор-выпускник"],
  [22, "Активный разработчик"],
];

function discordBadges(flags: number | null | undefined): string[] {
  if (!flags) return [];
  return DISCORD_BADGES.filter(([bit]) => (flags & (1 << bit)) !== 0).map(([, label]) => label);
}
type TabKey = (typeof TABS)[number]["key"];

const RECORD_STATUS_RU: Record<RecordStatus, string> = {
  ACTIVE: "Активен",
  CLOSED: "Закрыт",
  EXPIRED: "Истёк",
  REVOKED: "Отозван",
  ARCHIVED: "В архиве",
};

const TRANSFER_STATUS_RU: Record<string, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрен",
  REJECTED: "Отказано",
  CLOSED: "Закрыт",
};

function payloadText(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "—";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="muted u-m0">{children}</p>
  );
}

type FactionColor = Awaited<ReturnType<typeof getFactionColors>>;

function CharactersTab({ profile, factionColor }: { profile: PlayerProfile; factionColor: FactionColor }) {
  if (profile.characters.length === 0) {
    return (
      <div className="panel">
        <h2 className="panel-title">Персонажи</h2>
        <Empty>
          Персонажей пока нет. Персонаж создаётся автоматически, когда вы получаете нашивку командой{" "}
          <code>/нашивка получить</code> в Discord. На аккаунт — до трёх персонажей.
        </Empty>
      </div>
    );
  }
  return (
    <div className="id-card-grid">
      {profile.characters.map((character) => (
        <article className="id-card" key={character.id} style={factionStyle(factionColor(character.factionCode))}>
          <div className="id-card-photo" aria-hidden>
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
              <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
          <div className="id-card-body">
            <div className="id-card-top">
              <span className="id-card-title">San Andreas · ID</span>
              <span className="badge">Слот {character.slot}</span>
            </div>
            <h2 className="id-card-name">{character.name}</h2>
            <dl className="id-card-facts">
              <div>
                <dt>Статик</dt>
                <dd className="registry-mono">{character.staticId}</dd>
              </div>
              <div>
                <dt>Фракция</dt>
                <dd>
                  <FactionBadge code={character.factionCode} color={factionColor(character.factionCode)} />
                </dd>
              </div>
              {character.department ? (
                <div>
                  <dt>Отдел</dt>
                  <dd>{character.department}</dd>
                </div>
              ) : null}
              {character.rank ? (
                <div>
                  <dt>Ранг</dt>
                  <dd>{character.rank}</dd>
                </div>
              ) : null}
              <div>
                <dt>Нашивка</dt>
                <dd className="registry-mono">{character.activeToken ? character.activeToken.number : "—"}</dd>
              </div>
              {character.activeToken ? (
                <div>
                  <dt>Выдана</dt>
                  <dd>{formatMoscowShort(character.activeToken.issuedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          {character.blacklist ? (
            <p className="form-error id-card-wide">
              В IC чёрном списке: запись <strong>{character.blacklist.number}</strong>. Причина:{" "}
              {character.blacklist.reason}
            </p>
          ) : null}
          {character.tokens.some((token) => token.status !== RecordStatus.ACTIVE) ? (
            <p className="muted id-card-wide">
              Прежние нашивки:{" "}
              {character.tokens
                .filter((token) => token.status !== RecordStatus.ACTIVE)
                .map((token) => token.number)
                .join(", ")}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function RegistrationsTab({ profile }: { profile: PlayerProfile }) {
  return (
    <>
      <div className="panel">
        <h2 className="panel-title">Регистрации ТС и униформы</h2>
        {profile.registrations.length === 0 ? (
          <Empty>
            Заявок нет. Подать: <code>/регистрация-тс</code> или <code>/регистрация-формы</code> в Discord.
          </Empty>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Статик</th>
                  <th>Описание</th>
                  <th>Госномер</th>
                  <th>Статус</th>
                  <th>Подана</th>
                  <th>До</th>
                  <th>Отказ</th>
                </tr>
              </thead>
              <tbody>
                {profile.registrations.map((row) => {
                  const display = registrationDisplayStatus(row.decision, row.status);
                  const vehicle = row.kind === RegistrationKind.VEHICLE;
                  return (
                    <tr key={row.id}>
                      <td>{vehicle ? "ТС" : "Униформа"}</td>
                      <td className="registry-mono">{row.staticId}</td>
                      <td>{payloadText(row.payload, vehicle ? "model" : "description")}</td>
                      <td>
                        <Plate value={row.plate} />
                      </td>
                      <td>
                        <span className="registry-status" data-status={registrationStatusTone(display)}>
                          {REGISTRATION_DISPLAY_STATUS_RU[display]}
                        </span>
                      </td>
                      <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                      <td className="nowrap">{formatMoscowShort(row.expiresAt)}</td>
                      <td>{row.rejectionReason?.trim() || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Переводы между фракциями</h2>
        {profile.transfers.length === 0 ? (
          <Empty>
            Заявок на перевод нет. Ранг после перевода можно узнать в{" "}
            <Link href="/calculator">калькуляторе</Link>.
          </Empty>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Персонаж</th>
                  <th>Перевод</th>
                  <th>Ранг</th>
                  <th>Статус</th>
                  <th>Подана</th>
                  <th>Отказ</th>
                </tr>
              </thead>
              <tbody>
                {profile.transfers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.character.name} <span className="muted registry-mono">{row.character.staticId}</span>
                    </td>
                    <td>
                      {row.fromFactionCode} → {row.toFactionCode}
                    </td>
                    <td>
                      {row.fromRank} → {row.toRank}
                    </td>
                    <td>
                      <span
                        className="registry-status"
                        data-status={row.status === "APPROVED" ? "ok" : row.status === "PENDING" ? "warn" : "muted"}
                      >
                        {TRANSFER_STATUS_RU[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                    <td>{row.rejectionReason?.trim() || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function RecordsTab({ profile }: { profile: PlayerProfile }) {
  const noCharacters = profile.characters.length === 0;
  return (
    <>
      <div className="panel">
        <h2 className="panel-title">Штрафы</h2>
        {profile.fines.length === 0 ? (
          <Empty>
            {noCharacters
              ? "Штрафы ищутся по статикам ваших персонажей, а персонажей пока нет."
              : "Штрафов по вашим статикам нет."}
          </Empty>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>Сумма</th>
                  <th>Основание</th>
                  <th>Статус</th>
                  <th>Оплатить до</th>
                </tr>
              </thead>
              <tbody>
                {profile.fines.map((row) => (
                  <tr key={row.id}>
                    <td className="registry-mono">{row.number}</td>
                    <td className="registry-mono">{row.staticId}</td>
                    <td>
                      <Money state={row.status === RecordStatus.ACTIVE ? "due" : row.paidAt ? "paid" : "void"}>{formatMoney(row.amount)}</Money>
                    </td>
                    <td>{row.reason}</td>
                    <td>
                      <span className="registry-status" data-status={row.status === RecordStatus.ACTIVE ? "warn" : "ok"}>
                        {row.status === RecordStatus.ACTIVE
                          ? "Не оплачен"
                          : row.paidAt
                            ? "Оплачен"
                            : RECORD_STATUS_RU[row.status]}
                      </span>
                    </td>
                    <td className="nowrap">{formatMoscowShort(row.dueAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Федеральный розыск</h2>
        {profile.wanted.length === 0 ? (
          <Empty>
            {noCharacters
              ? "Розыск ищется по статикам ваших персонажей, а персонажей пока нет."
              : "Розысков по вашим статикам нет."}
          </Empty>
        ) : (
          <div className="registry-table-wrap">
            <table className="registry-table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Статик</th>
                  <th>Обвинение</th>
                  <th>Срок</th>
                  <th>Статус</th>
                  <th>Объявлен</th>
                </tr>
              </thead>
              <tbody>
                {profile.wanted.map((row) => (
                  <tr key={row.id}>
                    <td className="registry-mono">{row.number}</td>
                    <td className="registry-mono">{row.staticId}</td>
                    <td>{row.reason}</td>
                    <td>{row.termText}</td>
                    <td>
                      <WantedStars
                        active={row.status === RecordStatus.ACTIVE}
                        label={
                          row.status === RecordStatus.ACTIVE
                            ? "В розыске"
                            : row.status === RecordStatus.CLOSED
                              ? "Исполнен"
                              : (RECORD_STATUS_RU[row.status] ?? row.status)
                        }
                      />
                    </td>
                    <td className="nowrap">{formatMoscowShort(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSignedIn();
  const requested = (await searchParams).tab;
  const tab: TabKey = TABS.some((entry) => entry.key === requested) ? (requested as TabKey) : "overview";

  const factionColor = await getFactionColors();
  const [identity, memberships, profile] = await Promise.all([
    resolveFreshIdentity(session.user.discordId),
    prisma.guildMember.findMany({
      where: {
        userDiscordId: session.user.discordId,
        isPresent: true,
        guild: { status: RecordStatus.ACTIVE },
      },
      include: { guild: true },
      orderBy: { guild: { name: "asc" } },
    }),
    getPlayerProfile(session.user.discordId),
  ]);
  const positions = await getSetting("admins.positions");
  const badge = buildStatusBadge(identity, positions.find((row) => row.discordId === session.user.discordId)?.title);
  const sessions = tab === "sessions" ? await listSessionsForUser(session.user.id) : [];
  const mutedDm = tab === "notifications" ? await getMutedDmKinds(session.user.discordId) : [];
  const [history, personnel] =
    tab === "history"
      ? await Promise.all([
          listAuditLogPage({ actorDiscordId: session.user.discordId }),
          prisma.personnelEvent.findMany({
            where: { subjectDiscordId: session.user.discordId, status: RecordStatus.ACTIVE },
            orderBy: { createdAt: "desc" },
            take: 30,
          }),
        ])
      : [null, []];
  const snapshot = memberships.find((member) => member.publicFlags !== null || member.avatarDecorationUrl) ?? memberships[0];
  const accountBadges = discordBadges(snapshot?.publicFlags);
  const decoration = snapshot?.avatarDecorationUrl ?? null;

  const avatar =
    session.user.image ??
    memberships.find((m) => m.avatarUrl)?.avatarUrl ??
    memberships.find((m) => m.guildAvatarUrl)?.guildAvatarUrl ??
    null;

  const bannerUrl = session.user.bannerUrl ?? null;
  const accent = session.user.accentColor ?? badge.accentColor ?? null;
  const displayName = session.user.name ?? session.user.username ?? "Discord";

  const unpaidFines = profile.fines.filter((fine) => fine.status === RecordStatus.ACTIVE);
  const activeWanted = profile.wanted.filter((row) => row.status === RecordStatus.ACTIVE);
  const blacklisted = profile.characters.filter((character) => character.blacklist);
  const pendingRegistrations = profile.registrations.filter(
    (row) => registrationDisplayStatus(row.decision, row.status) === "PENDING",
  );

  return (
    <div className="stack">
      <div
        className="profile-hero"
        data-has-banner={Boolean(bannerUrl)}
        style={
          {
            ...(accent ? ({ ["--profile-accent" as string]: accent } as CSSProperties) : null),
            ...(bannerUrl
              ? ({ ["--profile-banner" as string]: `url(${bannerUrl})` } as CSSProperties)
              : null),
          } as CSSProperties
        }
      >
        <div className="profile-banner" aria-hidden />
        <div className="profile-identity">
          <div className="avatar-frame">
            {avatar ? (
              <Image className="avatar" src={avatar} alt="" width={84} height={84} unoptimized />
            ) : (
              <div className="avatar avatar-fallback" aria-hidden>
                {(displayName.trim().charAt(0) || "?").toUpperCase()}
              </div>
            )}
            {decoration ? (
              <Image className="avatar-decoration" src={decoration} alt="" width={104} height={104} unoptimized />
            ) : null}
          </div>
          <div className="profile-meta">
            <h1 className="truncate" title={displayName}>
              {displayName}
            </h1>
            <p className="muted handle truncate" title={`@${session.user.username ?? "discord"}`}>
              @{session.user.username ?? "discord"} · {session.user.discordId}
            </p>
            <div className="row">
              <span
                className="badge"
                data-kind={badge.kind}
                style={badge.accentColor ? { borderColor: badge.accentColor } : undefined}
              >
                {badge.primary}
              </span>
              {badge.secondary ? <span className="badge">{badge.secondary}</span> : null}
              {accountBadges.map((label) => (
                <span key={label} className="mini-tag profile-discord-badge">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <nav className="settings-tabs" aria-label="Разделы профиля">
        {TABS.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === "overview" ? "/profile" : `/profile?tab=${entry.key}`}
            className="settings-tab"
            data-active={entry.key === tab ? "" : undefined}
            aria-current={entry.key === tab ? "page" : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <>
          <div className="metric-grid">
            <Link href="/profile?tab=characters" className="metric-card">
              <span className="metric-label">Персонажи</span>
              <span className="metric-value">{profile.characters.length} / 3</span>
              <span className="metric-hint">
                Нашивок: {profile.characters.filter((character) => character.activeToken).length}
              </span>
            </Link>
            <Link href="/profile?tab=registrations" className="metric-card">
              <span className="metric-label">Заявки</span>
              <span className="metric-value">{pendingRegistrations.length}</span>
              <span className="metric-hint">на рассмотрении</span>
            </Link>
            <Link href="/profile?tab=records" className="metric-card">
              <span className="metric-label">Неоплаченные штрафы</span>
              <span className="metric-value">{unpaidFines.length}</span>
              <span className="metric-hint">
                {unpaidFines.length > 0
                  ? `на ${formatMoney(unpaidFines.reduce((sum, fine) => sum + fine.amount, 0))}`
                  : "задолженности нет"}
              </span>
            </Link>
            <Link href="/profile?tab=records" className="metric-card">
              <span className="metric-label">Розыск</span>
              <span className="metric-value">{activeWanted.length}</span>
              <span className="metric-hint">{activeWanted.length > 0 ? "активных ордеров" : "не в розыске"}</span>
            </Link>
          </div>
          {blacklisted.length > 0 ? (
            <p className="form-error">
              Персонаж{blacklisted.length > 1 ? "и" : ""} {blacklisted.map((character) => character.name).join(", ")}{" "}
              в IC чёрном списке. Подробности — на вкладке{" "}
              <Link href="/profile?tab=characters">«Персонажи и нашивки»</Link>.
            </p>
          ) : null}
        </>
      ) : null}

      {tab === "characters" ? <CharactersTab profile={profile} factionColor={factionColor} /> : null}
      {tab === "registrations" ? <RegistrationsTab profile={profile} /> : null}
      {tab === "records" ? <RecordsTab profile={profile} /> : null}

      {tab === "history" ? (
        <>
          <div className="panel">
            <h2 className="panel-title">Кадровые события</h2>
            {personnel.length === 0 ? (
              <Empty>Кадровых событий по вашему аккаунту нет.</Empty>
            ) : (
              <div className="registry-table-wrap">
                <table className="registry-table">
                  <thead>
                    <tr>
                      <th>Событие</th>
                      <th>Фракция</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personnel.map((event) => (
                      <tr key={event.id}>
                        <td>{PERSONNEL_EVENT_LABELS_RU[event.type as keyof typeof PERSONNEL_EVENT_LABELS_RU] ?? event.type}</td>
                        <td>
                          <FactionBadge code={event.factionCode} color={factionColor(event.factionCode)} />
                        </td>
                        <td className="nowrap">{formatMoscowShort(event.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="panel">
            <h2 className="panel-title">Ваши действия</h2>
            {!history || history.items.length === 0 ? (
              <Empty>Действий пока нет.</Empty>
            ) : (
              <div className="registry-table-wrap">
                <table className="registry-table">
                  <thead>
                    <tr>
                      <th>Когда</th>
                      <th>Действие</th>
                      <th>Запись</th>
                      <th>Где</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((event) => (
                      <tr key={event.id}>
                        <td className="nowrap">{formatMoscowShort(event.createdAt)}</td>
                        <td className="registry-mono">{event.action}</td>
                        <td>{event.entityType}</td>
                        <td className="muted">{event.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {tab === "notifications" ? (
        <div className="panel">
          <h2 className="panel-title">Личные сообщения от бота</h2>
          <p className="muted u-mt0 u-mb4">
            Отметьте, о чём бот может писать вам в личные сообщения Discord. Ответы администрации на ваши
            обращения приходят всегда.
          </p>
          <DmPreferencesForm kinds={DM_KINDS.map(({ key, label }) => ({ key, label }))} initialMuted={mutedDm} />
        </div>
      ) : null}

      {tab === "sessions" ? (
        <div className="panel">
          <h2 className="panel-title">Входы в дашборд</h2>
          <p className="muted u-mt0">
            Устройства, с которых выполнен вход в ваш аккаунт. Не узнаёте сессию — завершите её.
          </p>
          <SessionsList sessions={toSessionRows(sessions, session.sid)} allowRevokeOthers />
        </div>
      ) : null}

      {tab === "servers" ? (
        <>
          {identity.factions.length > 0 ? (
            <div className="panel">
              <h2 className="panel-title">Фракции</h2>
              <div className="row">
                {identity.factions.map((faction) => (
                  <span
                    key={faction.code}
                    className="badge"
                    style={faction.color ? { borderColor: faction.color } : undefined}
                  >
                    {[
                      faction.code,
                      faction.isLeader ? "лидер" : faction.isDeputy ? "заместитель" : null,
                      faction.departments[0],
                      faction.rank !== null ? `ранг ${faction.rank}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="panel">
            <h2 className="panel-title">Серверы</h2>
            <p className="muted u-mt0 u-mb4">
              Активные членства по снимку Discord. Роли считаются на момент последней синхронизации.
            </p>
            {memberships.length === 0 ? (
              <p className="muted">Нет данных снимка. Запустите бота на серверах, где вы состоите.</p>
            ) : (
              <div className="server-grid">
                {memberships.map((member) => {
                  const nick = member.nickname ?? member.globalName ?? member.username;
                  return (
                    <div className="server-card" key={member.id}>
                      <div className="min-w-0">
                        <span className="label">Сервер</span>
                        <strong className="truncate" title={member.guild.name}>
                          {member.guild.name}
                        </strong>
                      </div>
                      <div className="min-w-0">
                        <span className="label">Ник</span>
                        <span className="truncate" title={nick}>
                          {nick}
                        </span>
                      </div>
                      <div>
                        <span className="label">Вход</span>
                        <span>{formatMoscow(member.joinedAt)}</span>
                      </div>
                      <div>
                        <span className="label">Ролей</span>
                        <strong>{member.roleIds.length}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
