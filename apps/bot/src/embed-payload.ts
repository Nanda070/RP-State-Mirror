/**
 * Convert Mirror EmbedSpec JSON into discord.js send/edit options.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";
import type { ClassicEmbed, EmbedSpec, V2ActionRow, V2Button } from "@mirror/core";

const STYLE_MAP: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

export function classicToEmbed(spec: ClassicEmbed): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (spec.title) embed.setTitle(spec.title);
  if (spec.description) embed.setDescription(spec.description);
  if (spec.color !== undefined) embed.setColor(spec.color);
  if (spec.url) embed.setURL(spec.url);
  if (spec.author) {
    embed.setAuthor({
      name: spec.author.name,
      ...(spec.author.iconUrl ? { iconURL: spec.author.iconUrl } : {}),
      ...(spec.author.url ? { url: spec.author.url } : {}),
    });
  }
  if (spec.footer) {
    embed.setFooter({
      text: spec.footer.text,
      ...(spec.footer.iconUrl ? { iconURL: spec.footer.iconUrl } : {}),
    });
  }
  if (spec.image) embed.setImage(spec.image);
  if (spec.thumbnail) embed.setThumbnail(spec.thumbnail);
  if (spec.fields?.length) {
    embed.addFields(
      spec.fields.map((f) => ({
        name: f.name,
        value: f.value,
        ...(f.inline !== undefined ? { inline: f.inline } : {}),
      })),
    );
  }
  if (spec.timestamp) embed.setTimestamp();
  return embed;
}

function buildButton(btn: V2Button): ButtonBuilder {
  const builder = new ButtonBuilder().setLabel(btn.label);
  const style = STYLE_MAP[btn.style ?? "secondary"] ?? ButtonStyle.Secondary;
  builder.setStyle(style);
  if (btn.disabled) builder.setDisabled(true);
  if (style === ButtonStyle.Link) {
    if (!btn.url) throw new Error("Link-кнопка требует url");
    builder.setURL(btn.url);
  } else {
    if (!btn.customId) throw new Error("Интерактивная кнопка требует customId");
    builder.setCustomId(btn.customId);
  }
  if (btn.emoji) builder.setEmoji(btn.emoji);
  return builder;
}

function buildActionRow(row: V2ActionRow): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(row.components.map(buildButton));
}

export function embedSpecToMessageOptions(spec: EmbedSpec): MessageCreateOptions {
  if (spec.version === 1) {
    const options: MessageCreateOptions = {
      embeds: spec.embeds.map(classicToEmbed),
    };
    if (spec.components?.length) {
      options.components = spec.components.map(buildActionRow);
    }
    return options;
  }

  const containers = spec.components.map((container) => {
    const built = new ContainerBuilder();
    if (container.accentColor !== undefined) built.setAccentColor(container.accentColor);
    for (const node of container.components) {
      if (node.type === "text_display") {
        built.addTextDisplayComponents(new TextDisplayBuilder().setContent(node.content));
      } else if (node.type === "separator") {
        const sep = new SeparatorBuilder();
        if (node.divider !== undefined) sep.setDivider(node.divider);
        if (node.spacing === "large") sep.setSpacing(SeparatorSpacingSize.Large);
        else if (node.spacing === "small") sep.setSpacing(SeparatorSpacingSize.Small);
        built.addSeparatorComponents(sep);
      } else if (node.type === "media_gallery") {
        const gallery = new MediaGalleryBuilder();
        for (const item of node.items) {
          const media = new MediaGalleryItemBuilder().setURL(item.url);
          if (item.description) media.setDescription(item.description);
          gallery.addItems(media);
        }
        built.addMediaGalleryComponents(gallery);
      } else if (node.type === "action_row") {
        built.addActionRowComponents(buildActionRow(node));
      }
    }
    return built;
  });

  return {
    components: containers,
    flags: MessageFlags.IsComponentsV2,
  };
}
