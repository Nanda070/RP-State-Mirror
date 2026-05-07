import discord
from discord.ext import commands
from discord import app_commands

# Матрица: Сервер ID -> Роль ID
SERVER_ROLE_MAP = {
    1498402749241626686: 1498406705116217404,  # LSSD
    1498403964712910880: 1498412861108650005,  # LSPD
    1498407010541113422: 1498416090911477871,  # SASPA
    1498406591953637477: 1498413960444117073,  # ARMY
    1499466868942045224: 1499466951196410047,  # ЧП
    1499525332540330166: 1499525424445915136,  # GOV
    1498406065740578856: 1499505301689471127,  # FIB
    1501995710101328114: 1501995863541813348  # EMS
}


class GlobalAdminCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="выдать-admin-роль",
                          description="Выдача регламентированных ролей управления на серверах")
    @app_commands.rename(target="пользователь")
    async def grant_global_admin(self, it: discord.Interaction, target: discord.User):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message("Отказано. Требуются права администратора.", ephemeral=True)

        await it.response.defer(ephemeral=True)
        success_logs = []
        error_logs = []

        for guild_id, role_id in SERVER_ROLE_MAP.items():
            guild = self.bot.get_guild(guild_id)
            if not guild:
                continue

            member = guild.get_member(target.id)
            if not member:
                error_logs.append(f"{guild.name}: Субъект отсутствует на сервере")
                continue

            role = guild.get_role(role_id)
            if not role:
                error_logs.append(f"{guild.name}: Целевая роль не найдена")
                continue

            try:
                await member.add_roles(role, reason=f"Глобальное назначение. Инициатор: {it.user.name}")
                success_logs.append(f"{guild.name}: {role.name}")
            except discord.Forbidden:
                error_logs.append(f"{guild.name}: Ошибка доступа 403 (Бот ниже по иерархии)")
            except Exception as e:
                error_logs.append(f"{guild.name}: Сбой ({e})")

        report = f"**Отчет по выдаче полномочий для {target.mention}**\n\n"
        if success_logs:
            report += "**Успешно:**\n" + "\n".join(f"✅ {log}" for log in success_logs) + "\n\n"
        if error_logs:
            report += "**Пропущено / Ошибки:**\n" + "\n".join(f"❌ {log}" for log in error_logs)

        if not success_logs and not error_logs:
            report = "Нет доступных серверов для выполнения операции."

        for i in range(0, len(report), 1900):
            await it.followup.send(report[i:i + 1900], ephemeral=True)

    @app_commands.command(name="снять-admin-роль", description="Аннулирование регламентированных ролей управления")
    @app_commands.rename(target="пользователь")
    async def revoke_global_admin(self, it: discord.Interaction, target: discord.User):
        if not it.user.guild_permissions.administrator:
            return await it.response.send_message("Отказано. Требуются права администратора.", ephemeral=True)

        await it.response.defer(ephemeral=True)
        success_logs = []

        for guild_id, role_id in SERVER_ROLE_MAP.items():
            guild = self.bot.get_guild(guild_id)
            if not guild: continue

            member = guild.get_member(target.id)
            if not member: continue

            role = guild.get_role(role_id)
            if not role or role not in member.roles: continue

            try:
                await member.remove_roles(role, reason=f"Глобальное аннулирование. Инициатор: {it.user.name}")
                success_logs.append(f"{guild.name}: {role.name}")
            except Exception:
                pass

        if success_logs:
            report = f"**Полномочия субъекта {target.mention} аннулированы:**\n" + "\n".join(
                f"✅ {log}" for log in success_logs)
        else:
            report = f"У субъекта {target.mention} не обнаружено регламентированных ролей для снятия."

        for i in range(0, len(report), 1900):
            await it.followup.send(report[i:i + 1900], ephemeral=True)


async def setup(bot):
    await bot.add_cog(GlobalAdminCog(bot))
