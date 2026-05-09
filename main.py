import discord
import aiohttp
import logging
from datetime import timedelta
from discord.ext import commands, tasks
from discord import app_commands
from config import *
from utils import utc_now, utc_now_iso, parse_duration, send_via_webhook, safe_avatar_url, allowed_by_roles, \
    discord_identity
import embeds
import database
from iam_logic import evaluate_member_access

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger("bot")


class KickButtonView(discord.ui.View):
    def __init__(self, target: discord.Member, actor: discord.Member):
        super().__init__(timeout=300)
        self.target = target
        self.actor = actor
        self.message = None

    @discord.ui.button(label="Кикнуть с сервера", style=discord.ButtonStyle.danger, custom_id="audit_kick_btn")
    async def kick_button(self, it: discord.Interaction, btn: discord.ui.Button):
        if it.user.id != self.actor.id and not it.user.guild_permissions.kick_members:
            return await it.response.send_message("Только инициатор увольнения может использовать эту кнопку.",
                                                  ephemeral=True)
        try:
            await self.target.kick(reason=f"Кадровый аудит: уволен сотрудником {self.actor.name}")
            btn.disabled = True
            btn.label = "Сотрудник кикнут"
            btn.style = discord.ButtonStyle.secondary
            await it.response.edit_message(view=self)
            await it.followup.send(f"{self.target.mention} успешно исключен из Discord.", ephemeral=True)
        except discord.Forbidden:
            await it.response.send_message("Ошибка 403: Недостаточно прав для кика.", ephemeral=True)
        except Exception as e:
            await it.response.send_message(f"Ошибка при кике: {e}", ephemeral=True)

    async def on_timeout(self):
        for item in self.children: item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except:
                pass


class InterserverBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.members = True
        super().__init__(command_prefix=commands.when_mentioned, intents=intents, help_command=None)
        self.http_session = None

    async def setup_hook(self):
        await database.init_db()
        self.http_session = aiohttp.ClientSession()

        await self.load_extension("cmd_invites")
        await self.load_extension("cmd_crosscheck")
        await self.load_extension("cmd_global_admin")
        await self.load_extension("event_audit")

        for g_id in COMMAND_GUILD_IDS:
            guild = discord.Object(id=g_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        self.cleanup_posts.start()
        self.check_overdue_fines.start()
        self.roster_reconciliation.start()

    async def on_member_join(self, member):
        await evaluate_member_access(self, member.id)

    async def on_member_update(self, before, after):
        if before.roles != after.roles:
            faction_servers = {d["server_id"] for d in FACTIONS.values()}
            if after.guild.id in faction_servers or after.guild.id == MAIN_SERVER_ID:
                await evaluate_member_access(self, after.id)

    async def on_member_remove(self, member):
        if member.guild.id == MAIN_SERVER_ID: return
        faction_servers = {d["server_id"] for d in FACTIONS.values()}
        if member.guild.id in faction_servers:
            await evaluate_member_access(self, member.id)

    @tasks.loop(minutes=10)
    async def cleanup_posts(self):
        await database.cleanup_expired_posts(utc_now_iso())

    @tasks.loop(hours=1)
    async def roster_reconciliation(self):
        g = self.get_guild(MAIN_SERVER_ID)
        if g:
            for m in g.members:
                if not m.bot: await evaluate_member_access(self, m.id)

    @tasks.loop(minutes=1)
    async def check_overdue_fines(self):
        rows = await database.fetch_overdue_fines(utc_now_iso())
        if not rows or not FINE_NOTIFY_CHANNEL_ID: return
        try:
            channel = await self.fetch_channel(FINE_NOTIFY_CHANNEL_ID)
        except:
            return
        if not isinstance(channel, discord.TextChannel): return

        extra_pings = " ".join(f"<@&{rid}>" for rid in FINE_OVERDUE_PING_ROLES)
        for r in rows:
            embed = embeds.make_fine_overdue_embed(r)
            content = f"Штраф не оплачен. {r['created_by_mention']} {extra_pings}".strip()
            await channel.send(content=content, embed=embed,
                               allowed_mentions=discord.AllowedMentions(users=True, roles=True, everyone=False))
            await database.mark_fine_overdue_notified(r["fine_number"])

    @cleanup_posts.before_loop
    @roster_reconciliation.before_loop
    @check_overdue_fines.before_loop
    async def before_tasks(self):
        await self.wait_until_ready()


bot = InterserverBot()


# --- ДОКУМЕНТООБОРОТ ---
@bot.tree.command(name="пост", description="Опубликовать документ")
@app_commands.rename(
    faction="фракция",
    doc_number="номер",
    description="описание",
    notified_person="уведомляемое_лицо",
    forum_link="ссылка_на_форум",
    leader_text="ответственный_лидер",
    deputy_text="ответственный_зам"
)
@app_commands.choices(faction=[app_commands.Choice(name=f, value=f) for f in FACTION_NAMES])
async def post(it: discord.Interaction, faction: app_commands.Choice[str], doc_number: str, description: str,
               notified_person: str, forum_link: str, leader_text: str, deputy_text: str):
    if not allowed_by_roles(it.user, POST_ALLOWED_ROLE_IDS): return await it.response.send_message("Нет доступа.",
                                                                                                   ephemeral=True)
    f_data = FACTIONS.get(faction.value)
    if not f_data or not f_data.get('webhook'): return await it.response.send_message("Вебхук фракции не настроен.",
                                                                                      ephemeral=True)
    if await database.fetch_post(doc_number): return await it.response.send_message("Документ уже существует.",
                                                                                    ephemeral=True)

    embed = embeds.make_document_embed(it.user, faction.value, doc_number, description, notified_person, forum_link,
                                       leader_text, deputy_text)
    content = f"Новый документ из правительства. <@&{f_data['leader_role_id']}> незамедлительно исполнить."

    await send_via_webhook(bot.http_session, f_data['webhook'], embed=embed, content=content,
                           username=it.user.display_name, avatar_url=safe_avatar_url(it.user))

    await database.save_post({
        "doc_number": doc_number, "faction": faction.value, "description": description,
        "notified_person": notified_person,
        "forum_link": forum_link, "leader_text": leader_text, "deputy_text": deputy_text, "author_id": it.user.id,
        "author_display_name": it.user.display_name, "author_username": it.user.name, "author_mention": it.user.mention,
        "created_at": utc_now_iso(), "expires_at": (utc_now() + timedelta(hours=72)).isoformat()
    })
    await it.response.send_message(f"Документ {doc_number} отправлен.", ephemeral=True)


@bot.tree.command(name="ответ", description="Ответить на документ")
@app_commands.rename(
    doc_number="номер",
    personal_file="личное_дело",
    video="видеофиксация",
    comment="комментарий"
)
async def answer(it: discord.Interaction, doc_number: str, personal_file: str, video: str, comment: str):
    if not RESPONSE_WEBHOOK: return await it.response.send_message("Вебхук не настроен.", ephemeral=True)
    row = await database.fetch_post(doc_number)
    if not row: return await it.response.send_message("Документ не найден.", ephemeral=True)

    embed = embeds.make_response_embed(row, it.user, personal_file, video, comment)
    await send_via_webhook(bot.http_session, RESPONSE_WEBHOOK, embed=embed, content=row['author_mention'],
                           username=f"Ответ | {it.user.display_name}", avatar_url=safe_avatar_url(it.user))
    await it.response.send_message("Ответ отправлен.", ephemeral=True)


# --- РОЗЫСК ---
@bot.tree.command(name="объявить-розыск", description="Объявить федеральный розыск")
@app_commands.rename(number="номер", fio="фио", passport="паспорт", article="статья", term_text="срок", forum_link="ссылка_на_форум")
async def announce_wanted(it: discord.Interaction, number: str, fio: str, passport: str, article: str, term_text: str, forum_link: str):
    if not allowed_by_roles(it.user, WANTED_ALLOWED_ROLE_IDS): return await it.response.send_message("Нет доступа.", ephemeral=True)
    if not WANTED_WEBHOOK: return await it.response.send_message("Вебхук не настроен.", ephemeral=True)

    existing = await database.fetch_wanted(number)
    if existing and not existing["closed_at"]: return await it.response.send_message("Открытый розыск с таким номером уже существует.", ephemeral=True)

    embed = embeds.make_wanted_embed(it.user.display_name, it.user.name, safe_avatar_url(it.user), fio, passport, number, article, term_text, forum_link)
    content = " ".join(f"<@&{r}>" for r in WANTED_PING_ROLES)
    msg = await send_via_webhook(bot.http_session, WANTED_WEBHOOK, embed=embed, content=content, username=f"Wanted | {it.user.display_name}", avatar_url=safe_avatar_url(it.user), wait=True)

    await database.save_wanted({
        "wanted_number": number, "fio": fio, "passport": passport, "article": article, "term_text": term_text, "forum_link": forum_link,
        "message_id": msg.id, "announced_by_id": it.user.id, "announced_by_display_name": it.user.display_name,
        "announced_by_username": it.user.name, "announced_by_avatar_url": safe_avatar_url(it.user), "created_at": utc_now_iso()
    })
    await it.response.send_message(f"Розыск {number} объявлен.", ephemeral=True)

@bot.tree.command(name="розыск-исполнено", description="Закрыть розыск")
@app_commands.rename(number="номер", evidence_link="доказательства")
async def wanted_done(it: discord.Interaction, number: str, evidence_link: str):
    if not allowed_by_roles(it.user, WANTED_ALLOWED_ROLE_IDS): return await it.response.send_message("Нет доступа.", ephemeral=True)
    row = await database.fetch_wanted(number)
    if not row: return await it.response.send_message("Розыск не найден.", ephemeral=True)
    if row["closed_at"]: return await it.response.send_message("Уже закрыт.", ephemeral=True)

    closed_by = discord_identity(it.user.display_name, it.user.name)
    # Передаем forum_link из БД для сохранения структуры
    updated_embed = embeds.make_wanted_embed(row["announced_by_display_name"], row["announced_by_username"], row["announced_by_avatar_url"], row["fio"], row["passport"], row["wanted_number"], row["article"], row["term_text"], row["forum_link"], closed=True, closed_by=closed_by, evidence_link=evidence_link)

    wh = discord.Webhook.from_url(WANTED_WEBHOOK, session=bot.http_session)
    await wh.edit_message(row["message_id"], content="~~Федеральный розыск~~", embed=updated_embed)

    done_embed = embeds.make_wanted_done_embed(it.user, number, evidence_link)
    await send_via_webhook(bot.http_session, WANTED_WEBHOOK, embed=done_embed, username=f"Wanted | {it.user.display_name}", avatar_url=safe_avatar_url(it.user))

    await database.close_wanted(number, closed_by, evidence_link)
    await it.response.send_message("Розыск закрыт.", ephemeral=True)

# --- ШТРАФЫ ---
@bot.tree.command(name="штраф", description="Выписать штраф")
@app_commands.rename(faction="фракция", fine_number="номер", fio="фио", passport="паспорт", article="статья", amount="сумма", payment_deadline="срок_оплаты")
@app_commands.choices(faction=[app_commands.Choice(name=f, value=f) for f in FACTION_NAMES])
async def fine_cmd(it: discord.Interaction, faction: app_commands.Choice[str], fine_number: str, fio: str, passport: str, article: str, amount: str, payment_deadline: str):
    # Код функции без изменений
    if not allowed_by_roles(it.user, FINE_ALLOWED_ROLE_IDS): return await it.response.send_message("Нет доступа.", ephemeral=True)
    f_data = FACTIONS.get(faction.value)
    if not f_data or not f_data.get('webhook'): return await it.response.send_message("Вебхук не настроен.", ephemeral=True)
    if await database.fetch_fine(fine_number): return await it.response.send_message("Штраф уже есть.", ephemeral=True)

    try: delta = parse_duration(payment_deadline)
    except ValueError as e: return await it.response.send_message(str(e), ephemeral=True)

    due_at = (utc_now() + delta).isoformat()
    embed = embeds.make_fine_embed(it.user, faction.value, fine_number, fio, passport, article, amount, payment_deadline)
    content = f"Новый штраф из правительства. <@&{f_data['leader_role_id']}> требуется исполнение и контроль оплаты."

    await send_via_webhook(bot.http_session, f_data['webhook'], embed=embed, content=content, username=it.user.display_name, avatar_url=safe_avatar_url(it.user))

    await database.save_fine({
        "fine_number": fine_number, "faction": faction.value, "fio": fio, "passport": passport, "article": article,
        "amount": amount, "payment_deadline_text": payment_deadline, "due_at": due_at, "created_by_id": it.user.id,
        "created_by_display_name": it.user.display_name, "created_by_username": it.user.name, "created_by_mention": it.user.mention,
        "created_at": utc_now_iso()
    })
    await it.response.send_message(f"Штраф {fine_number} отправлен.", ephemeral=True)

@bot.tree.command(name="штраф-оплачено", description="Отметить штраф оплаченным")
@app_commands.rename(fine_number="номер")
async def fine_paid(it: discord.Interaction, fine_number: str):
    # Код функции без изменений
    if not allowed_by_roles(it.user, FINE_ALLOWED_ROLE_IDS): return await it.response.send_message("Нет доступа.", ephemeral=True)
    row = await database.fetch_fine(fine_number)
    if not row: return await it.response.send_message("Не найден.", ephemeral=True)
    if row["paid_at"]: return await it.response.send_message("Уже оплачен.", ephemeral=True)

    paid_by = discord_identity(it.user.display_name, it.user.name)
    await database.mark_fine_paid(fine_number, paid_by)
    updated = await database.fetch_fine(fine_number)

    await it.response.send_message(embed=embeds.make_fine_paid_embed(updated, it.user))
# --- АУДИТ ---

@bot.tree.command(name="аудит-повышение", description="Оформить повышение")
@app_commands.rename(target="повышаемый", old_rank="был", new_rank="стал", reason="причина")
async def audit_promote(it: discord.Interaction, target: discord.Member, old_rank: str, new_rank: str, reason: str):
    details = f"**Был:** {old_rank} | **Стал:** {new_rank} | **Причина:** {reason}"
    embed = embeds.make_compact_audit_embed("повышения", it.user, target, "Повысил:", "Повышаемый:", details)
    await it.response.send_message(content=f"{it.user.mention} Повысил {target.mention}", embed=embed)


@bot.tree.command(name="аудит-увольнение", description="Оформить увольнение")
@app_commands.rename(target="увольняемый", rank="уволен_с_ранга", reason="причина")
async def audit_fire(it: discord.Interaction, target: discord.Member, rank: str, reason: str):
    details = f"**Уволен с ранга:** {rank} | **Причина:** {reason}"
    embed = embeds.make_compact_audit_embed("увольнения", it.user, target, "Уволил:", "Увольняемый:", details)

    view = KickButtonView(target, it.user)
    await it.response.send_message(content=f"{it.user.mention} Уволил {target.mention}", embed=embed, view=view)
    view.message = await it.original_response()


@bot.tree.command(name="аудит-перевод-отдел", description="Перевод внутри департамента")
@app_commands.rename(target="пользователь", old_role="был", new_role="стал")
async def audit_transfer_dept(it: discord.Interaction, target: discord.Member, old_role: discord.Role,
                              new_role: discord.Role):
    details = f"**Был:** {old_role.mention} | **Стал:** {new_role.mention}"
    embed = embeds.make_compact_audit_embed("перевода (Отдел)", it.user, target, "Оформил перевод:", "Переведенный:",
                                            details)
    await it.response.send_message(content=f"{it.user.mention} Перевел {target.mention}", embed=embed)


@bot.tree.command(name="аудит-перевод-фракция", description="Межведомственный перевод")
@app_commands.rename(target="пользователь", old_faction="прошлая_фракция")
@app_commands.choices(
    old_faction=[app_commands.Choice(name=f, value=f) for f in ["LSPD", "LSSD", "ARMY", "SASPA", "GOV", "FIB"]])
async def audit_transfer_faction(it: discord.Interaction, target: discord.Member,
                                 old_faction: app_commands.Choice[str]):
    details = f"**Прошлая фракция:** {old_faction.value}"
    embed = embeds.make_compact_audit_embed("перевода (Фракция)", it.user, target, "Оформил перевод:", "Переведенный:",
                                            details)
    await it.response.send_message(content=f"{it.user.mention} Перевел {target.mention}", embed=embed)


@bot.tree.command(name="аудит-восстановления", description="Восстановление в должности")
@app_commands.rename(target="пользователь", rank="восстановлен_на")
async def audit_restore(it: discord.Interaction, target: discord.Member, rank: str):
    details = f"**Восстановлен на:** {rank}"
    embed = embeds.make_compact_audit_embed("восстановления", it.user, target, "Восстановил:", "Восстановленный:",
                                            details)
    await it.response.send_message(content=f"{it.user.mention} Восстановил {target.mention}", embed=embed)


@bot.tree.command(name="аудит-назначение-на-должность", description="Назначение")
@app_commands.rename(target="пользователь", reason="причина")
async def audit_appoint(it: discord.Interaction, target: discord.Member, reason: str):
    details = f"**Причина:** {reason}"
    embed = embeds.make_compact_audit_embed("назначения", it.user, target, "Назначил:", "Назначенный:", details)
    await it.response.send_message(content=f"{it.user.mention} Назначил {target.mention}", embed=embed)

# --- ОТЛАДКА ---
@bot.tree.command(name="синхронизация", description="Принудительная синхронизация доступов")
async def force_sync(it: discord.Interaction, target: discord.Member):
    if not it.user.guild_permissions.manage_roles: return await it.response.send_message("Нет прав.", ephemeral=True)
    await it.response.defer(ephemeral=True)
    await evaluate_member_access(bot, target.id)
    await it.followup.send(f"Аудит доступов для {target.mention} завершен.", ephemeral=True)


if __name__ == "__main__":
    if not TOKEN: raise ValueError("Токен бота не найден в .env")
    bot.run(TOKEN)
