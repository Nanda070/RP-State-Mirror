"use client";

import type { EmbedSpec } from "@mirror/core/embeds";

function colorHex(color?: number): string {
  if (color === undefined) return "#4e5058";
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function EmbedPreview({ spec }: { spec: EmbedSpec }) {
  if (spec.version === 2) {
    return (
      <div className="embed-preview">
        <p className="embed-preview-label">Превью Components V2</p>
        {spec.components.map((container, ci) => (
          <div
            key={ci}
            className="embed-v2-container"
            style={{ borderColor: colorHex(container.accentColor) }}
          >
            {container.components.map((node, ni) => {
              if (node.type === "text_display") {
                return (
                  <p key={ni} className="embed-v2-text">
                    {node.content || "—"}
                  </p>
                );
              }
              if (node.type === "separator") {
                return <hr key={ni} className="embed-v2-sep" />;
              }
              if (node.type === "media_gallery") {
                return (
                  <div key={ni} className="embed-v2-media muted">
                    Медиа: {node.items.length} файл(ов)
                  </div>
                );
              }
              if (node.type === "action_row") {
                return (
                  <div key={ni} className="embed-preview-buttons">
                    {node.components.map((btn, bi) => (
                      <span key={bi} className="embed-preview-btn" data-style={btn.style ?? "secondary"}>
                        {btn.label}
                      </span>
                    ))}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="embed-preview">
      <p className="embed-preview-label">Превью</p>
      {spec.embeds.map((embed, i) => (
        <div key={i} className="embed-classic" style={{ borderLeftColor: colorHex(embed.color) }}>
          {embed.author?.name ? <div className="embed-author">{embed.author.name}</div> : null}
          {embed.title ? <div className="embed-title">{embed.title}</div> : null}
          {embed.description ? (
            <div className="embed-desc">{embed.description}</div>
          ) : null}
          {embed.fields?.length ? (
            <div className="embed-fields">
              {embed.fields.map((f, fi) => (
                <div key={fi} className="embed-field" data-inline={f.inline ? "1" : "0"}>
                  <strong>{f.name}</strong>
                  <span>{f.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {embed.footer?.text ? <div className="embed-footer">{embed.footer.text}</div> : null}
        </div>
      ))}
      {spec.components?.length ? (
        <div className="embed-preview-buttons">
          {spec.components.flatMap((row, ri) =>
            row.type === "role_select"
              ? [
                  <span key={`${ri}-select`} className="embed-preview-btn" data-style="secondary">
                    {row.placeholder ?? "Выберите роли"} ▾
                  </span>,
                ]
              : row.components.map((btn, bi) => (
                  <span key={`${ri}-${bi}`} className="embed-preview-btn" data-style={btn.style ?? "secondary"}>
                    {btn.label}
                  </span>
                )),
          )}
        </div>
      ) : null}
    </div>
  );
}
