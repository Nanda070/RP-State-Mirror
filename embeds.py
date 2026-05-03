import discord
from datetime import datetime, timezone, timedelta
from utils import footer_text, safe_avatar_url, normalize_link_or_text, discord_identity
from config import COLOR_DEFAULT, BOT_FOOTER_ICON

COLOR_DEFAULT = 0x8989A8
COLOR_RESPONSE = 0x8B6F47
COLOR_WANTED = 0x6E6B73
COLOR_WANTED_DONE = 0x5A8F63
COLOR_SUCCESS = 0x5A8F63
COLOR_ERROR = 0xA64B4B
COLOR_FINE = 0xB07A3F
COLOR_FINE_PAID = 0x5A8F63
COLOR_FINE_OVERDUE = 0xA64B4B

def make_document_embed(actor, faction, doc_number, description, notified_person, forum_link, leader_text, deputy_text):
    embed = discord.Embed(title=f"Новый документ от {actor.display_name}", color=COLOR_DEFAULT)
    embed.description = (f"**Уведомляемая фракция:** {faction}\n**Уведомляемое лицо:** {notified_person}\n"
                         f"**Номер документа:** {doc_number}\n**Краткое описание:** {description}\n"
                         f"**Ответственные:** {leader_text}, {deputy_text}, {notified_person}.")
    embed.add_field(name="Ссылка на форум", value=f"||{forum_link}||", inline=False)
    embed.set_author(name=f"Автор: {actor.name}", icon_url=safe_avatar_url(actor))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def make_response_embed(source_post, actor, personal_file, video, comment):
    embed = discord.Embed(title=f"Ответ на Документ {source_post['doc_number']}", color=COLOR_RESPONSE)
    embed.description = (f"**Личное дело:** {normalize_link_or_text(personal_file)}\n"
                         f"**Видеофиксация:** {normalize_link_or_text(video)}\n"
                         f"**Комментарий:** {normalize_link_or_text(comment)}")
    embed.set_author(name=f"Автор ответа: {actor.name}", icon_url=safe_avatar_url(actor))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed


def make_wanted_embed(actor_name, actor_username, actor_avatar_url, fio, passport, order_number, article, term_text,
                      forum_link, closed=False, closed_by=None, evidence_link=None):
    embed = discord.Embed(
        title="Новый ордер от правительства штата" if not closed else "Исполненный ордер правительства штата",
        color=COLOR_WANTED_DONE if closed else COLOR_WANTED)
    lines = [f"Издал ордер: {actor_name}", f"Разыскиваемый: **{fio}**", f"Номер паспорта: **{passport}**",
             f"Номер ордера: **{order_number}**", f"Обвинения: **{article}**", f"Срок заключения: **{term_text}**"]
    if closed:
        struck = "\n".join(f"~~{line}~~" for line in lines)
        status = f"\n\n**Статус:** Исполнено\n**Исполнение зарегистрировал:** {closed_by}\n**Доказательства:** {normalize_link_or_text(evidence_link)}"
        embed.description = struck + status
    else:
        embed.description = "\n".join(lines)

    # Выводим ссылку на форум, если розыск активен
    if forum_link and not closed:
        embed.add_field(name="Ссылка на форум", value=f"||{forum_link}||", inline=False)

    embed.set_author(name=f"Автор: {actor_username}", icon_url=actor_avatar_url)
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def make_wanted_done_embed(actor, wanted_number, evidence_link):
    embed = discord.Embed(title="Зарегистрировано исполнение ордера", color=COLOR_WANTED_DONE)
    embed.description = (f"Исполнение зарегистрировал: **{discord_identity(actor.display_name, actor.name)}**\n"
                         f"Номер ордера: **{wanted_number}**\n"
                         f"Доказательства исполнения: {normalize_link_or_text(evidence_link)}")
    embed.set_author(name=f"Автор: {actor.name}", icon_url=safe_avatar_url(actor))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def make_fine_embed(actor, faction, fine_number, fio, passport, article, amount, payment_deadline_text):
    embed = discord.Embed(title=f"Новый штраф от {actor.display_name}", color=COLOR_FINE)
    embed.description = (f"**Уведомляемая фракция:** {faction}\n**Номер штрафа:** {fine_number}\n"
                         f"**ФИО:** {fio}\n**Паспорт:** {passport}\n**Статья:** {article}\n"
                         f"**Сумма штрафа:** {amount}\n**Срок оплаты:** {payment_deadline_text}")
    embed.set_author(name=f"Автор: {actor.name}", icon_url=safe_avatar_url(actor))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def make_fine_paid_embed(fine_row, actor):
    embed = discord.Embed(title="Штраф оплачен", color=COLOR_FINE_PAID)
    embed.description = (f"**Номер штрафа:** {fine_row['fine_number']}\n**ФИО:** {fine_row['fio']}\n"
                         f"**Паспорт:** {fine_row['passport']}\n**Сумма:** {fine_row['amount']}\n"
                         f"**Оплату зарегистрировал:** {discord_identity(actor.display_name, actor.name)}")
    embed.set_author(name=f"Автор: {actor.name}", icon_url=safe_avatar_url(actor))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def make_fine_overdue_embed(fine_row):
    embed = discord.Embed(title="Неоплаченный штраф", color=COLOR_FINE_OVERDUE)
    embed.description = (f"**Номер штрафа:** {fine_row['fine_number']}\n**Фракция:** {fine_row['faction']}\n"
                         f"**ФИО:** {fine_row['fio']}\n**Паспорт:** {fine_row['passport']}\n"
                         f"**Статья:** {fine_row['article']}\n**Сумма штрафа:** {fine_row['amount']}\n"
                         f"**Срок оплаты истёк:** {fine_row['payment_deadline_text']}\n"
                         f"**Штраф выписал:** {fine_row['created_by_display_name']} ({fine_row['created_by_username']})")
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed

def get_msk_time_str() -> str:
    msk_tz = timezone(timedelta(hours=3))
    return datetime.now(msk_tz).strftime('%d.%m.%Y %H:%M МСК')


def make_compact_audit_embed(action_title: str, actor: discord.Member, target: discord.Member,
                             actor_label: str, target_label: str, details_text: str) -> discord.Embed:
    embed = discord.Embed(title=f"Кадровый-Аудит {action_title}", color=COLOR_DEFAULT)

    embed.add_field(name=actor_label, value=f"{actor.display_name} | {actor.id}", inline=False)
    embed.add_field(name=target_label, value=f"{target.display_name} | {target.id}", inline=False)

    if details_text:
        embed.add_field(name="\u200b", value=details_text, inline=False)

    embed.set_thumbnail(url=safe_avatar_url(target))
    embed.set_footer(text=f"Бот Orbit | {get_msk_time_str()}", icon_url=BOT_FOOTER_ICON)
    return embed

def make_sync_log_embed(member, action, details, color):
    embed = discord.Embed(title=f"Синхронизация доступов: {action}", color=color, timestamp=discord.utils.utcnow())
    embed.description = f"**Пользователь:** {member.mention}\n**Discord:** {discord_identity(member.display_name, member.name)}\n**User ID:** `{member.id}`\n\n{details}"
    embed.set_thumbnail(url=safe_avatar_url(member))
    embed.set_footer(text=footer_text(), icon_url=BOT_FOOTER_ICON)
    return embed