import discord
from discord.ext import commands
from discord import app_commands
from config import FACTIONS, COLOR_SUCCESS

# Дополнительные сервера строго для команды инвайтов
EXTRA_SERVERS = {
    "DB": 1499482249832169622,
    "DD": 1499482507970744461,
    "CID": 1499479912430567454
}


class InvitesCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="инвайт-админ", description="Генерация временных инвайтов (30 минут, 3 слота)")
    async def invite_admin(self, it: discord.Interaction):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message("Отказано в доступе. Требуются права администратора.", ephemeral=True)

        await it.response.defer()
        lines = []

        # Собираем единый пул серверов (Фракции + Доп. сервера)
        all_targets = {name: data["server_id"] for name, data in FACTIONS.items()}
        all_targets.update(EXTRA_SERVERS)

        for name, guild_id in all_targets.items():
            guild = self.bot.get_guild(guild_id)
            if not guild:
                lines.append(f"**{name}**: ❌ Сервер недоступен для бота")
                continue

            # Ищем первый доступный текстовый канал, где бот имеет право создать инвайт
            channel = next((c for c in guild.text_channels if c.permissions_for(guild.me).create_instant_invite), None)
            if not channel:
                lines.append(f"**{name}**: ❌ Ошибка прав маршрутизации инвайта")
                continue

            try:
                # 1800 секунд = 30 минут, max_uses = 3
                inv = await channel.create_invite(max_age=1800, max_uses=3, reason=f"Служебный запрос: {it.user.name}")
                lines.append(f"**{name}**: {inv.url}")
            except Exception as e:
                lines.append(f"**{name}**: ❌ Системная ошибка ({e})")

        embed = discord.Embed(title="Шлюзы доступа сгенерированы", description="\n".join(lines), color=COLOR_SUCCESS)
        await it.followup.send(embed=embed)


async def setup(bot):
    await bot.add_cog(InvitesCog(bot))