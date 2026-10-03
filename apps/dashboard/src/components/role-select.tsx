"use client";

export type RoleSelectOption = {
  discordId: string;
  name: string;
  guildDiscordId: string;
};

export function RoleSelect({
  id,
  value,
  onChange,
  roles,
  guildDiscordId,
  allowEmpty = true,
  emptyLabel = "Не выбрана",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  roles: RoleSelectOption[];
  guildDiscordId?: string | null;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const options = guildDiscordId
    ? roles.filter((r) => r.guildDiscordId === guildDiscordId)
    : roles;

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((r) => (
        <option key={r.discordId} value={r.discordId}>
          @{r.name}
        </option>
      ))}
    </select>
  );
}
