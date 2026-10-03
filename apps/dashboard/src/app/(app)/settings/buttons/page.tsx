import { embedSpecSchema, listRolePanels } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import { RolePanelsManager, type RolePanelSummary } from "@/components/role-panels-manager";
import { getActiveChannelOptions, getActiveGuildOptions } from "@/lib/catalog";
import { formatMoscow } from "@/lib/moscow";
import { requireSystemSettingsPage } from "@/lib/session";

export const metadata = { title: "Кнопки и роли" };

function summarize(spec: unknown): Pick<RolePanelSummary, "title" | "mode" | "labels"> {
  const parsed = embedSpecSchema.safeParse(spec);
  if (!parsed.success || parsed.data.version !== 1) return { title: "Панель", mode: "buttons", labels: [] };
  const rows = parsed.data.components ?? [];
  const select = rows.find((row) => row.type === "role_select");
  return {
    title: parsed.data.embeds[0]?.title ?? "Панель",
    mode: select ? "select" : "buttons",
    labels: rows.flatMap((row) =>
      row.type === "role_select" ? row.options.map((option) => option.label) : row.components.map((b) => b.label),
    ),
  };
}

export default async function RolePanelsPage() {
  await requireSystemSettingsPage();
  const [panels, guilds, channels, roles] = await Promise.all([
    listRolePanels(),
    getActiveGuildOptions(),
    getActiveChannelOptions(),
    prisma.discordRole.findMany({
      where: { status: RecordStatus.ACTIVE, guild: { status: RecordStatus.ACTIVE } },
      orderBy: [{ position: "desc" }, { name: "asc" }],
      select: { discordId: true, name: true, managed: true, guild: { select: { discordId: true } } },
    }),
  ]);
  const guildName = new Map(guilds.map((guild) => [guild.discordId, guild.name]));
  const channelName = new Map(channels.map((channel) => [channel.discordId, channel.name]));

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Кнопки и роли</h1>
        <p className="muted">
          Сообщения бота, по которым участники сами берут и снимают роли: кнопками или выпадающим списком.
          Бот публикует панель в выбранный канал и продолжает обрабатывать её после перезапуска.
        </p>
      </div>
      <RolePanelsManager
        guilds={guilds.map((guild) => ({ discordId: guild.discordId, name: guild.name }))}
        channels={channels.map((channel) => ({
          discordId: channel.discordId,
          name: channel.name,
          guildDiscordId: channel.guild.discordId,
          guildName: channel.guild.name,
        }))}
        roles={roles
          // @everyone shares its id with the guild; managed roles belong to integrations.
          .filter((role) => !role.managed && role.discordId !== role.guild.discordId)
          .map((role) => ({ discordId: role.discordId, name: role.name, guildDiscordId: role.guild.discordId }))}
        panels={panels.map((panel) => ({
          id: panel.id,
          ...summarize(panel.spec),
          guildName: guildName.get(panel.guildDiscordId) ?? panel.guildDiscordId,
          channelName: channelName.get(panel.channelDiscordId) ?? panel.channelDiscordId,
          messageUrl: panel.messageDiscordId
            ? `https://discord.com/channels/${panel.guildDiscordId}/${panel.channelDiscordId}/${panel.messageDiscordId}`
            : null,
          updatedAt: formatMoscow(panel.updatedAt),
        }))}
      />
    </div>
  );
}
