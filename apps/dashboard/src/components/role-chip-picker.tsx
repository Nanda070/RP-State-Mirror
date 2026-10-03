"use client";

export type RoleChipOption = {
  discordId: string;
  name: string;
  /** Optional group label (e.g. «GOV» / «ЧП») for dual-guild pickers. */
  group?: string;
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
      <p className="muted u-m0">
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

  const hasGroups = roles.some((role) => role.group);
  if (!hasGroups) {
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

  const groups: Array<{ label: string; roles: RoleChipOption[] }> = [];
  for (const role of roles) {
    const label = role.group ?? "";
    const existing = groups.find((g) => g.label === label);
    if (existing) existing.roles.push(role);
    else groups.push({ label, roles: [role] });
  }

  return (
    <div className="chip-groups">
      {groups.map((group) => (
        <div key={group.label || "ungrouped"} className="chip-group">
          {group.label ? <div className="chip-group-title">{group.label}</div> : null}
          <div className="chip-row">
            {group.roles.map((role) => (
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
        </div>
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
      <p className="muted u-m0">
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
