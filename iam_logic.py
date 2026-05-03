import discord
import logging
from config import MAIN_SERVER_ID, FACTIONS, LOG_CHANNEL_ID, COLOR_SUCCESS, COLOR_ERROR, EXCLUDED_MAIN_ROLE_IDS
from embeds import make_sync_log_embed

logger = logging.getLogger("iam")


async def safe_fetch_member(guild, member_id):
    m = guild.get_member(member_id)
    if m: return m
    try:
        return await guild.fetch_member(member_id)
    except:
        return None


async def send_sync_log(bot, member, action, details, color):
    if not LOG_CHANNEL_ID: return
    channel = bot.get_channel(LOG_CHANNEL_ID)
    if not channel:
        try:
            channel = await bot.fetch_channel(LOG_CHANNEL_ID)
        except:
            return
    if isinstance(channel, discord.TextChannel):
        await channel.send(embed=make_sync_log_embed(member, action, details, color))


async def evaluate_member_access(bot, member_id):
    main_guild = bot.get_guild(MAIN_SERVER_ID)
    if not main_guild: return

    member = await safe_fetch_member(main_guild, member_id)
    if not member or member.bot or member.id == main_guild.owner_id: return

    if any(r.id in EXCLUDED_MAIN_ROLE_IDS for r in member.roles):
        return

    valid_roles = set()
    for f_data in FACTIONS.values():
        f_guild = bot.get_guild(f_data["server_id"])
        if not f_guild: continue
        f_m = await safe_fetch_member(f_guild, member_id)
        if f_m and any(r.id == f_data["faction_role_id"] for r in f_m.roles):
            valid_roles.add(f_data["main_role_id"])

    if not valid_roles:
        try:
            await member.send(
                "Доступ аннулирован. Вы исключены из сервера ЧП, так как не состоите ни в одной официальной фракции.")
        except:
            pass
        try:
            await member.kick(reason="Автоматическая синхронизация: потеряны фракционные роли.")
            await send_sync_log(bot, member, "KICK",
                                "**Причина:** Потеряны все фракционные роли.\nУчастник исключен из ЧП.", COLOR_ERROR)
        except discord.Forbidden:
            logger.error(f"Синхронизация: 403 Forbidden. Не могу кикнуть {member.name}.")
        return

    managed = {d["main_role_id"] for d in FACTIONS.values()}
    current = {r.id for r in member.roles}

    to_add = [main_guild.get_role(rid) for rid in valid_roles if rid not in current]
    to_remove = [main_guild.get_role(rid) for rid in managed if rid in current and rid not in valid_roles]
    to_add = [r for r in to_add if r]
    to_remove = [r for r in to_remove if r]

    if to_add or to_remove:
        try:
            if to_add: await member.add_roles(*to_add, reason="Синхронизация ЧП")
            if to_remove: await member.remove_roles(*to_remove, reason="Синхронизация ЧП")
            lines = []
            if to_add: lines.append(f"**Выданы роли:** {', '.join(r.mention for r in to_add)}")
            if to_remove: lines.append(f"**Сняты роли:** {', '.join(r.mention for r in to_remove)}")
            await send_sync_log(bot, member, "UPDATE", "\n".join(lines), COLOR_SUCCESS)
        except discord.Forbidden:
            logger.error(f"Синхронизация: 403 Forbidden при обновлении ролей {member.name}.")