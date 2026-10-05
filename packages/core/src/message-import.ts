/**
 * An existing Discord message → a template of the message editor (PLAN §5.10).
 *
 * The dashboard cannot read Discord: it queues `message_design.import`, the bot fetches the raw
 * message (`GET /channels/{id}/messages/{id}`) and turns it into an EmbedSpec here. The editor
 * then opens it as a new, unsaved template.
 *
 * Carried over: classic embeds with every field, Components V2 containers with text, galleries,
 * separators and sections, link buttons, and Mirror's own buttons and role dropdowns (their action
 * comes back from `button_actions`). What the editor cannot hold is named in `notes`: buttons of
 * other bots (kept, but switched off), files, other dropdowns.
 */
import { JobStatus, prisma } from "@mirror/db";
import { z } from "zod";
import {
  BUTTON_ACTIONS,
  embedSpecSchema,
  parseCustomId,
  type ClassicEmbed,
  type EmbedSpec,
  type InteractiveRow,
  type V2Button,
  type V2Component,
  type V2RoleSelect,
} from "./embeds.js";
import { UserError } from "./errors.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";

// Raw Discord API shapes (snake_case), only the parts that are read.
type RawEmoji = { id?: string | null; name?: string | null; animated?: boolean };
type RawComponent = {
  type: number;
  style?: number;
  label?: string;
  url?: string;
  custom_id?: string;
  emoji?: RawEmoji | null;
  disabled?: boolean;
  content?: string;
  accent_color?: number | null;
  divider?: boolean;
  spacing?: number;
  items?: { media?: { url?: string }; description?: string | null }[];
  media?: { url?: string };
  description?: string | null;
  accessory?: RawComponent;
  placeholder?: string;
  max_values?: number;
  options?: { label: string; value: string; description?: string | null; emoji?: RawEmoji | null }[];
  components?: RawComponent[];
};
type RawEmbed = {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name?: string; url?: string; icon_url?: string };
  footer?: { text?: string; icon_url?: string };
  image?: { url?: string };
  thumbnail?: { url?: string };
  fields?: { name?: string; value?: string; inline?: boolean }[];
};
export type RawDiscordMessage = {
  content?: string;
  flags?: number;
  embeds?: RawEmbed[];
  components?: RawComponent[];
  attachments?: unknown[];
};

const IS_COMPONENTS_V2 = 1 << 15;
const COMPONENT = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  FILE: 13,
  SEPARATOR: 14,
  CONTAINER: 17,
} as const;
const BUTTON_STYLE: Record<number, V2Button["style"]> = { 1: "primary", 2: "secondary", 3: "success", 4: "danger", 5: "link" };
const DISCORD_CDN = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;

const urlSchema = z.string().url();
function validUrl(value: string | null | undefined): string | undefined {
  return value && urlSchema.safeParse(value).success ? value : undefined;
}

function emojiText(emoji: RawEmoji | null | undefined): string | undefined {
  if (!emoji) return undefined;
  if (emoji.id) return `<${emoji.animated ? "a" : ""}:${emoji.name ?? "emoji"}:${emoji.id}>`;
  return emoji.name ?? undefined;
}

function cut(text: string, max: number, notes: Set<string>, what: string): string {
  if (text.length <= max) return text;
  notes.add(`${what} длиннее ${max} символов — обрезан.`);
  return text.slice(0, max);
}

class Converter {
  readonly notes = new Set<string>();
  private cdnImages = false;

  image(url: string | undefined): string | undefined {
    const valid = validUrl(url);
    if (valid && DISCORD_CDN.test(valid)) this.cdnImages = true;
    return valid;
  }

  finish(): string[] {
    if (this.cdnImages) {
      this.notes.add("Картинки из вложений Discord могут перестать открываться: лучше заменить их постоянными ссылками.");
    }
    return [...this.notes];
  }

  embed(raw: RawEmbed): ClassicEmbed | null {
    if (raw.type && raw.type !== "rich") {
      this.notes.add("Превью ссылок (не эмбеды бота) пропущены.");
      return null;
    }
    const embed: ClassicEmbed = { type: "embed" };
    if (raw.title) embed.title = cut(raw.title, 256, this.notes, "Заголовок");
    if (raw.description) embed.description = cut(raw.description, 4096, this.notes, "Описание");
    if (typeof raw.color === "number") embed.color = raw.color;
    const url = validUrl(raw.url);
    if (url) embed.url = url;
    if (raw.author?.name) {
      const iconUrl = this.image(raw.author.icon_url);
      const authorUrl = validUrl(raw.author.url);
      embed.author = {
        name: cut(raw.author.name, 256, this.notes, "Автор"),
        ...(iconUrl ? { iconUrl } : {}),
        ...(authorUrl ? { url: authorUrl } : {}),
      };
    }
    if (raw.footer?.text) {
      const iconUrl = this.image(raw.footer.icon_url);
      embed.footer = { text: cut(raw.footer.text, 2048, this.notes, "Подвал"), ...(iconUrl ? { iconUrl } : {}) };
    }
    const image = this.image(raw.image?.url);
    if (image) embed.image = image;
    const thumbnail = this.image(raw.thumbnail?.url);
    if (thumbnail) embed.thumbnail = thumbnail;
    const fields = (raw.fields ?? []).slice(0, 25).map((field) => ({
      // Discord shows an empty name or value as a gap; the editor needs some text there.
      name: cut(field.name?.trim() ? field.name : "​", 256, this.notes, "Название поля"),
      value: cut(field.value?.trim() ? field.value : "​", 1024, this.notes, "Значение поля"),
      ...(field.inline ? { inline: true } : {}),
    }));
    if (fields.length > 0) embed.fields = fields;
    if (raw.timestamp) embed.timestamp = true;
    return embed;
  }

  async button(raw: RawComponent): Promise<V2Button | null> {
    const label = (raw.label?.trim() || emojiText(raw.emoji) || "Кнопка").slice(0, 80);
    const emoji = raw.label?.trim() ? emojiText(raw.emoji) : undefined;
    const base = { type: "button" as const, label, ...(emoji ? { emoji } : {}) };
    if (raw.style === 5) {
      const url = validUrl(raw.url);
      if (!url) return null;
      return { ...base, style: "link", url };
    }
    if (raw.style === 6) {
      this.notes.add("Кнопки покупки пропущены.");
      return null;
    }
    const style = BUTTON_STYLE[raw.style ?? 2] ?? "secondary";
    const own = raw.custom_id ? parseCustomId(raw.custom_id) : null;
    if (own && (BUTTON_ACTIONS as readonly string[]).includes(own.action)) {
      const stored = await prisma.buttonAction.findUnique({ where: { id: own.id } });
      if (stored && stored.action === own.action) {
        const params = (stored.params ?? {}) as Record<string, unknown>;
        return {
          ...base,
          style,
          action: own.action as V2Button["action"],
          ...(Object.keys(params).length > 0 ? { params } : {}),
        };
      }
    }
    this.notes.add("Кнопки другого бота или устаревшие кнопки перенесены выключенными — назначьте им действие.");
    return { ...base, style, disabled: true, action: "callback" };
  }

  async roleSelect(raw: RawComponent): Promise<V2RoleSelect | null> {
    const own = raw.custom_id ? parseCustomId(raw.custom_id) : null;
    if (!own || own.action !== "role.select") {
      this.notes.add("Выпадающие списки, кроме списков ролей Mirror, пропущены.");
      return null;
    }
    const stored = await prisma.buttonAction.findUnique({ where: { id: own.id } });
    const params = (stored?.params ?? {}) as { allowedRoleIds?: unknown };
    const options = (raw.options ?? [])
      .filter((option) => /^\d{17,20}$/.test(option.value))
      .slice(0, 25)
      .map((option) => {
        const emoji = emojiText(option.emoji);
        return {
          label: option.label.slice(0, 100),
          roleDiscordId: option.value,
          ...(option.description ? { description: option.description.slice(0, 100) } : {}),
          ...(emoji ? { emoji } : {}),
        };
      });
    if (options.length === 0) return null;
    const allowed = Array.isArray(params.allowedRoleIds)
      ? params.allowedRoleIds.filter((id): id is string => typeof id === "string" && /^\d{17,20}$/.test(id)).slice(0, 25)
      : [];
    return {
      type: "role_select",
      options,
      ...(raw.placeholder ? { placeholder: raw.placeholder.slice(0, 150) } : {}),
      ...(raw.max_values ? { maxValues: Math.min(Math.max(raw.max_values, 1), 25) } : {}),
      ...(allowed.length > 0 ? { allowedRoleIds: allowed } : {}),
    };
  }

  /** A row under a message or inside a container: buttons, or one dropdown. */
  async row(raw: RawComponent): Promise<InteractiveRow | null> {
    const children = raw.components ?? [];
    const select = children.find((child) => child.type === COMPONENT.STRING_SELECT);
    if (select) return this.roleSelect(select);
    if (children.some((child) => child.type !== COMPONENT.BUTTON)) {
      this.notes.add("Выпадающие списки пользователей, ролей и каналов пропущены.");
    }
    const buttons: V2Button[] = [];
    for (const child of children.filter((entry) => entry.type === COMPONENT.BUTTON).slice(0, 5)) {
      const button = await this.button(child);
      if (button) buttons.push(button);
    }
    return buttons.length > 0 ? { type: "action_row", components: buttons } : null;
  }

  /** Components V2 nodes inside a container (sections are unfolded into text, picture and buttons). */
  async nodes(raw: RawComponent[]): Promise<V2Component[]> {
    const result: V2Component[] = [];
    for (const node of raw) {
      switch (node.type) {
        case COMPONENT.TEXT_DISPLAY:
          if (node.content) result.push({ type: "text_display", content: cut(node.content, 4096, this.notes, "Текст") });
          break;
        case COMPONENT.SEPARATOR:
          result.push({
            type: "separator",
            ...(node.divider === false ? { divider: false } : {}),
            ...(node.spacing === 2 ? { spacing: "large" as const } : {}),
          });
          break;
        case COMPONENT.MEDIA_GALLERY: {
          const items = (node.items ?? [])
            .map((item) => {
              const url = this.image(item.media?.url);
              return url ? { url, ...(item.description ? { description: item.description.slice(0, 1024) } : {}) } : null;
            })
            .filter((item): item is { url: string; description?: string } => item !== null)
            .slice(0, 10);
          if (items.length > 0) result.push({ type: "media_gallery", items });
          break;
        }
        case COMPONENT.SECTION: {
          result.push(...(await this.nodes(node.components ?? [])));
          const accessory = node.accessory;
          if (accessory?.type === COMPONENT.THUMBNAIL) {
            const url = this.image(accessory.media?.url);
            if (url) result.push({ type: "media_gallery", items: [{ url }] });
            this.notes.add("Миниатюры в разделах стали картинками под текстом.");
          } else if (accessory?.type === COMPONENT.BUTTON) {
            const button = await this.button(accessory);
            if (button) result.push({ type: "action_row", components: [button] });
            this.notes.add("Кнопки сбоку от текста стали кнопками под текстом.");
          }
          break;
        }
        case COMPONENT.ACTION_ROW: {
          const row = await this.row(node);
          if (row) result.push(row);
          break;
        }
        case COMPONENT.FILE:
          this.notes.add("Файлы в сообщении пропущены.");
          break;
        default:
          break;
      }
    }
    return result;
  }
}

/** Splits nodes into containers of at most ten, the editor's limit. */
function containersOf(nodes: V2Component[], accentColor: number | null | undefined, notes: Set<string>) {
  const containers = [];
  for (let index = 0; index < nodes.length; index += 10) {
    containers.push({
      type: "container" as const,
      ...(typeof accentColor === "number" ? { accentColor } : {}),
      components: nodes.slice(index, index + 10),
    });
  }
  if (containers.length > 1) notes.add("Длинный контейнер разбит на несколько.");
  return containers;
}

export async function discordMessageToSpec(raw: RawDiscordMessage): Promise<{ spec: EmbedSpec; notes: string[] }> {
  const converter = new Converter();
  let spec: EmbedSpec;

  if (((raw.flags ?? 0) & IS_COMPONENTS_V2) !== 0) {
    const containers = [];
    let loose: V2Component[] = [];
    const flush = () => {
      if (loose.length > 0) containers.push(...containersOf(loose, undefined, converter.notes));
      loose = [];
    };
    for (const node of raw.components ?? []) {
      if (node.type === COMPONENT.CONTAINER) {
        flush();
        const inner = await converter.nodes(node.components ?? []);
        if (inner.length > 0) containers.push(...containersOf(inner, node.accent_color, converter.notes));
      } else {
        // Text, galleries and rows outside a container go into one of their own.
        loose.push(...(await converter.nodes([node])));
      }
    }
    flush();
    if (containers.length > 5) converter.notes.add("Больше пяти контейнеров — лишние отброшены.");
    spec = { version: 2, components: containers.slice(0, 5) };
  } else {
    const embeds = (raw.embeds ?? []).map((embed) => converter.embed(embed)).filter((embed): embed is ClassicEmbed => embed !== null);
    const rows: InteractiveRow[] = [];
    for (const node of raw.components ?? []) {
      if (node.type !== COMPONENT.ACTION_ROW) continue;
      const row = await converter.row(node);
      if (row) rows.push(row);
    }
    const content = raw.content?.trim();
    if (embeds.length === 0) {
      // A plain text message: Components V2 holds text without an embed frame.
      const nodes: V2Component[] = [];
      if (content) nodes.push({ type: "text_display", content: cut(content, 4096, converter.notes, "Текст") });
      nodes.push(...rows);
      if (nodes.length === 0) throw new UserError("В сообщении нет ни текста, ни эмбедов, которые можно перенести.");
      spec = { version: 2, components: containersOf(nodes, undefined, converter.notes).slice(0, 5) };
      converter.notes.add("Сообщение без эмбедов открыто в формате Components V2.");
    } else {
      if (content) {
        // The classic format has no text above the embeds: it becomes an embed of its own.
        embeds.unshift({ type: "embed", description: cut(content, 4096, converter.notes, "Текст") });
        converter.notes.add("Текст над эмбедами перенесён в отдельный эмбед.");
      }
      spec = { version: 1, embeds: embeds.slice(0, 10), ...(rows.length > 0 ? { components: rows.slice(0, 5) } : {}) };
    }
  }

  if ((raw.attachments ?? []).length > 0) converter.notes.add("Вложенные файлы не переносятся.");
  const parsed = embedSpecSchema.safeParse(spec);
  if (!parsed.success) throw new UserError("Это сообщение не удалось перевести в шаблон редактора.");
  return { spec: parsed.data, notes: converter.finish() };
}

// ── The job around it ──────────────────────────────────────────────────────────────────────

const MESSAGE_LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;

/** `https://discord.com/channels/<server>/<channel>/<message>` → the three ids. */
export function parseDiscordMessageLink(link: string) {
  const match = MESSAGE_LINK.exec(link.trim());
  if (!match) {
    throw new UserError("Нужна ссылка на сообщение: в Discord — «Копировать ссылку на сообщение».");
  }
  return { guildDiscordId: match[1] ?? "", channelDiscordId: match[2] ?? "", messageDiscordId: match[3] ?? "" };
}

/** Asks the bot to read a message; the editor polls `getMessageImport` for the result. */
export async function enqueueMessageImport(link: string, requestedBy: string) {
  const ids = parseDiscordMessageLink(link);
  const guild = await prisma.guild.findFirst({ where: { discordId: ids.guildDiscordId, status: "ACTIVE" } });
  if (!guild) throw new UserError("Бота нет на сервере этого сообщения.");
  return enqueueJob({
    type: MODULE_JOB_TYPES.MESSAGE_DESIGN_IMPORT,
    payload: { ...ids, requestedBy },
    // A wrong link or a closed channel is an answer for the person, not something to retry.
    maxAttempts: 1,
  });
}

export type MessageImportState =
  | { state: "pending" }
  | { state: "done"; spec: EmbedSpec; notes: string[] }
  | { state: "failed"; error: string };

export async function getMessageImport(jobId: string, requestedBy: string): Promise<MessageImportState> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const payload = (job?.payload ?? {}) as { requestedBy?: unknown };
  if (!job || job.type !== MODULE_JOB_TYPES.MESSAGE_DESIGN_IMPORT || payload.requestedBy !== requestedBy) {
    throw new UserError("Загрузка не найдена.");
  }
  if (job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING) return { state: "pending" };
  const result = (job.result ?? {}) as { spec?: unknown; notes?: unknown; error?: unknown };
  if (job.status === JobStatus.SUCCEEDED && result.spec) {
    const spec = embedSpecSchema.safeParse(result.spec);
    if (spec.success) {
      return { state: "done", spec: spec.data, notes: Array.isArray(result.notes) ? result.notes.map(String) : [] };
    }
  }
  return {
    state: "failed",
    error: typeof result.error === "string" ? result.error : "Бот не смог прочитать сообщение. Попробуйте ещё раз.",
  };
}
