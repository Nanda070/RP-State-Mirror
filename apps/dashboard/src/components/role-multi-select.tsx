"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type RoleOption = {
  discordId: string;
  name: string;
  color: number;
  category: string;
};

export type SelectedRole = {
  mappingId: string;
  discordId: string;
  name: string;
  color: number;
};

function roleTextColor(color: number): string | undefined {
  if (!color) return undefined;
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function RoleMultiSelect({
  label,
  hint,
  selected,
  options,
  disabled,
  onAdd,
  onRemove,
}: {
  label: string;
  hint?: string;
  selected: SelectedRole[];
  options: RoleOption[];
  disabled?: boolean;
  onAdd: (roleDiscordId: string) => void;
  onRemove: (mappingId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIds = useMemo(() => new Set(selected.map((item) => item.discordId)), [selected]);

  const grouped = useMemo(() => {
    const available = options.filter((role) => !selectedIds.has(role.discordId));
    const map = new Map<string, RoleOption[]>();
    for (const role of available) {
      const list = map.get(role.category) ?? [];
      list.push(role);
      map.set(role.category, list);
    }
    return [...map.entries()];
  }, [options, selectedIds]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div className="field role-multi-field">
      <label>{label}</label>
      {hint ? <p className="muted field-hint">{hint}</p> : null}
      <div className="role-multi" ref={rootRef} data-open={open || undefined}>
        <div
          className="role-multi-control"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          tabIndex={0}
          onClick={() => {
            if (!disabled) setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen((value) => !value);
            }
          }}
        >
          <div className="role-multi-chips">
            {selected.map((role) => (
              <span key={role.mappingId} className="role-chip">
                <span className="role-chip-name" title={role.name}>
                  {role.name}
                </span>
                <button
                  type="button"
                  className="role-chip-x"
                  aria-label={`Убрать ${role.name}`}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(role.mappingId);
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="role-multi-add"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
            >
              + Добавить…
            </button>
          </div>
          <span className="role-multi-chevron" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </div>

        {open ? (
          <div id={listId} className="role-multi-menu" role="listbox">
            {grouped.length === 0 ? (
              <p className="muted role-multi-empty">Нет доступных ролей</p>
            ) : (
              grouped.map(([category, roles]) => (
                <div key={category} className="role-multi-group">
                  <div className="role-multi-group-title">—— {category} ——</div>
                  {roles.map((role) => (
                    <button
                      key={role.discordId}
                      type="button"
                      className="role-multi-option"
                      role="option"
                      style={roleTextColor(role.color) ? { color: roleTextColor(role.color) } : undefined}
                      onClick={() => {
                        onAdd(role.discordId);
                        setOpen(false);
                      }}
                    >
                      {role.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
