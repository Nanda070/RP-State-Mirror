"use client";

export type ChannelOption = {
  discordId: string;
  name: string;
  guildDiscordId: string;
};

export function ChannelSelect({
  id,
  value,
  onChange,
  channels,
  guildDiscordId,
  allowEmpty = true,
  emptyLabel = "Не выбран",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  channels: ChannelOption[];
  guildDiscordId?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const options = guildDiscordId
    ? channels.filter((c) => c.guildDiscordId === guildDiscordId)
    : channels;

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((c) => (
        <option key={c.discordId} value={c.discordId}>
          #{c.name}
        </option>
      ))}
    </select>
  );
}
