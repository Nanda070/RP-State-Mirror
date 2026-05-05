import discord
from discord.ext import commands
from discord import app_commands
from config import FACTIONS

# Словарь с ID кастомных эмодзи из Developer Portal
FACTION_EMOJI_IDS = {
    "FIB": 1501198392825479168,
    "ARMY": 1501198384864690186,
    "SASPA": 1501198399108681788,
    "LSPD": 1501198395845378129,
    "GOV": 1501198394574639104,
    "EMS": 1501198391038705714,
    "LSSD": 1501198397569368195
}


class FactionKickButton(discord.ui.Button):
    def __init__(self, faction_name: str, guild_id: int, target_id: int, target_name: str, emoji: discord.PartialEmoji):
        super().__init__(label=faction_name, emoji=emoji, style=discord.ButtonStyle.secondary)
        self.faction_name = faction_name
        self.guild_id = guild_id
        self.target_id = target_id
        self.target_name = target_name

    async def callback(self, it: discord.Interaction):
        if it.user.id != self.view.admin_id and not it.user.guild_permissions.administrator:
            return await it.response.send_message("Отказано в доступе. Вы не являетесь инициатором.", ephemeral=True)

        guild = it.client.get_guild(self.guild_id)
        if not guild:
            return await it.response.send_message(f"Сервер {self.faction_name} недоступен.", ephemeral=True)

        member = guild.get_member(self.target_id)
        if not member:
            return await it.response.send_message("Субъект уже покинул указанный сервер.", ephemeral=True)

        try:
            await member.kick(reason=f"Кросс-фракционный аудит. Инициатор: {it.user.name}")
            await it.response.send_message(f"Успешно: {self.target_name} исключен из {self.faction_name}.",
                                           ephemeral=True)
            self.disabled = True
            self.style = discord.ButtonStyle.danger
            await it.message.edit(view=self.view)
        except discord.Forbidden:
            await it.response.send_message(
                f"Ошибка 403: Отказано в доступе. Проверьте иерархию ролей бота в {self.faction_name}.", ephemeral=True)


class UserFactionAuditView(discord.ui.View):
    def __init__(self, target_id: int, target_name: str, factions: list, admin_id: int):
        super().__init__(timeout=None)
        self.admin_id = admin_id

        for f_name, g_id in factions:
            emoji_id = FACTION_EMOJI_IDS.get(f_name)
            # Инициализация кастомного эмодзи по ID
            custom_emoji = discord.PartialEmoji(id=emoji_id, name=f_name) if emoji_id else None
            self.add_item(FactionKickButton(f_name, g_id, target_id, target_name, custom_emoji))


class CrossCheckCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="проверить-фракции", description="Аудит кросс-фракционных пересечений личного состава")
    async def check_factions(self, it: discord.Interaction):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message("Отказано в доступе.", ephemeral=True)

        await it.response.defer()
        violators = []

        for member in it.guild.members:
            if member.bot: continue

            user_factions = []
            for f_name, f_data in FACTIONS.items():
                if f_data["server_id"] == it.guild.id: continue

                f_guild = self.bot.get_guild(f_data["server_id"])
                if f_guild and f_guild.get_member(member.id):
                    user_factions.append((f_name, f_data["server_id"]))

            if user_factions:
                violators.append({"member": member, "factions": user_factions})

        if not violators:
            return await it.followup.send(f"{it.user.mention} - проверка завершена. Пересечений не выявлено.")

        await it.followup.send("Генерация отчета по пересечениям...")

        for data in violators:
            member = data["member"]
            factions = data["factions"]
            f_names = [f[0] for f in factions]

            # Текст: @Тег (ID) - ФРАКЦИЯ1, ФРАКЦИЯ2
            content = f"{member.mention} ({member.id}) - {', '.join(f_names)}"
            view = UserFactionAuditView(member.id, member.display_name, factions, it.user.id)

            await it.channel.send(content=content, view=view)

        await it.channel.send(f"{it.user.mention} - проверка завершена. Спасибо за работу.")


async def setup(bot):
    await bot.add_cog(CrossCheckCog(bot))