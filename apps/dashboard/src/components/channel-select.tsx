"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export type ChannelOption = {
  discordId: string;
  name: string;
  guildDiscordId: string;
  guildName?: string;
};

/**
 * Channel picker with search. Channels of several servers are grouped by server;
 * with `guildDiscordId` only that server's channels are offered.
 */
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => (guildDiscordId ? channels.filter((channel) => channel.guildDiscordId === guildDiscordId) : channels),
    [channels, guildDiscordId],
  );
  const selected = channels.find((channel) => channel.discordId === value) ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    const found = q ? options.filter((channel) => channel.name.toLowerCase().includes(q)) : options;
    const byGuild = new Map<string, ChannelOption[]>();
    for (const channel of found) {
      const key = guildDiscordId ? "" : (channel.guildName ?? "");
      byGuild.set(key, [...(byGuild.get(key) ?? []), channel]);
    }
    return [...byGuild.entries()];
  }, [options, query, guildDiscordId]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="combo" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="combo-control"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="combo-value" data-empty={selected ? undefined : ""}>
          {selected
            ? guildDiscordId || !selected.guildName
              ? `#${selected.name}`
              : `#${selected.name} · ${selected.guildName}`
            : emptyLabel}
        </span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="combo-pop">
          <input
            autoFocus
            className="combo-search"
            placeholder="Поиск канала"
            aria-label="Поиск канала"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const first = groups[0]?.[1][0];
              if (first) pick(first.discordId);
            }}
          />
          <div className="combo-list" role="listbox">
            {allowEmpty && !query.trim() ? (
              <button type="button" role="option" aria-selected={value === ""} className="combo-option" onClick={() => pick("")}>
                {emptyLabel}
              </button>
            ) : null}
            {groups.map(([guildName, items]) => (
              <Fragment key={guildName}>
                {guildName ? <div className="combo-group">{guildName}</div> : null}
                {items.map((channel) => (
                  <button
                    key={channel.discordId}
                    type="button"
                    role="option"
                    aria-selected={channel.discordId === value}
                    className="combo-option"
                    onClick={() => pick(channel.discordId)}
                  >
                    #{channel.name}
                  </button>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 ? <p className="combo-empty">Каналов не найдено</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
