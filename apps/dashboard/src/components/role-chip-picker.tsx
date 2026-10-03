"use client";

export type RoleChipOption = {
  discordId: string;
  name: string;
};

export function RoleChipPicker({
  roles,
  selected,
  onChange,
  emptyHint,
}: {
  roles: RoleChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint: string;
}) {
  if (roles.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyHint}
      </p>
    );
  }

  function toggle(roleId: string) {
    onChange(
      selected.includes(roleId)
        ? selected.filter((id) => id !== roleId)
        : [...selected, roleId],
    );
  }

  return (
    <div className="chip-row">
      {roles.map((role) => (
        <label key={role.discordId} className="chip-check">
          <input
            type="checkbox"
            checked={selected.includes(role.discordId)}
            onChange={() => toggle(role.discordId)}
          />
          {role.name}
        </label>
      ))}
    </div>
  );
}

export function GuildChipPicker({
  guilds,
  selected,
  onChange,
  emptyHint,
}: {
  guilds: Array<{ discordId: string; name: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint: string;
}) {
  if (guilds.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyHint}
      </p>
    );
  }

  function toggle(guildId: string) {
    onChange(
      selected.includes(guildId)
        ? selected.filter((id) => id !== guildId)
        : [...selected, guildId],
    );
  }

  return (
    <div className="chip-row">
      {guilds.map((guild) => (
        <label key={guild.discordId} className="chip-check">
          <input
            type="checkbox"
            checked={selected.includes(guild.discordId)}
            onChange={() => toggle(guild.discordId)}
          />
          {guild.name}
        </label>
      ))}
    </div>
  );
}
