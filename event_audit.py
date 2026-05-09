import discord
from discord.ext import commands


class AuditCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # В Cogs события оборачиваются декоратором @commands.Cog.listener()
    @commands.Cog.listener()
    async def on_app_command_completion(self, interaction: discord.Interaction, command):
        target_cmds = ["пост", "розыск-исполнено", "объявить-розыск", "штраф"]
        user = interaction.user
        guild_name = interaction.guild.name if interaction.guild else "ЛС"

        # === ВЕТКА 1: Централизованный аудит ===
        if command.name in target_cmds:
            CENTRAL_GUILD_ID = 1499466868942045224
            LOG_CHANNEL_ID = 1499476282323370035

            # Обращаемся через self.bot, так как мы внутри Cog
            central_guild = self.bot.get_guild(CENTRAL_GUILD_ID)
            if central_guild:
                log_channel = central_guild.get_channel(LOG_CHANNEL_ID)
                if log_channel:
                    embed = discord.Embed(
                        title=f"Аудит: Операция /{command.name}",
                        color=0x2b2d31,
                        timestamp=discord.utils.utcnow()
                    )

                    embed.add_field(name="ID", value=f"`{user.id}`", inline=True)
                    embed.add_field(name="Username", value=f"`{user.name}`", inline=True)
                    embed.add_field(name="Tag", value=user.mention, inline=True)
                    embed.add_field(name="Локация (Фракция)", value=f"`{guild_name}`", inline=False)

                    opts = interaction.data.get("options", [])
                    if opts:
                        params_text = ""
                        for opt in opts:
                            opt_name = opt.get('name', 'Неизвестно')
                            opt_value = opt.get('value', '...')
                            params_text += f"**{opt_name.capitalize()}**: {opt_value}\n"

                        embed.add_field(name="Вводные данные", value=params_text, inline=False)
                    else:
                        embed.add_field(name="Вводные данные", value="Параметры отсутствуют", inline=False)

                    try:
                        await log_channel.send(embed=embed)
                    except Exception as e:
                        print(f"[ОШИБКА] Сбой экспорта лога в центральный канал: {e}")
            else:
                print(f"[КРИТ] Бот не авторизован на центральном сервере {CENTRAL_GUILD_ID}")

        # === ВЕТКА 2: Локальный аудит ===
        else:
            print(f"[АУДИТ] {user.name} ({user.id}) выполнил /{command.name} на сервере: {guild_name}")

            if interaction.guild:
                local_log_channel = discord.utils.get(interaction.guild.text_channels, name="bot-logs") or \
                                    discord.utils.get(interaction.guild.text_channels, name="state-bot-logs")

                if local_log_channel:
                    opts = interaction.data.get("options", [])
                    params = ", ".join(
                        [f"{o['name']}={o.get('value', '...')}" for o in opts]) if opts else "Отсутствуют"

                    embed = discord.Embed(title="Аудит действий: Slash Command", color=0x2b2d31)
                    embed.add_field(name="Инициатор", value=f"{user.mention} ({user.id})", inline=False)
                    embed.add_field(name="Операция", value=f"`/{command.name}`", inline=True)
                    embed.add_field(name="Аргументы", value=f"`{params}`", inline=True)

                    try:
                        await local_log_channel.send(embed=embed)
                    except Exception:
                        pass


async def setup(bot):
    await bot.add_cog(AuditCog(bot))

    # Регистрация глобального перехватчика сбоев прямо из модуля аудита
    async def global_tree_error(interaction: discord.Interaction, error: discord.app_commands.AppCommandError):
        cmd_name = interaction.command.name if interaction.command else "Системная_ошибка"
        print(f"[ОТКАЗ] Операция /{cmd_name} от {interaction.user.name}. Причина: {error}")

        if not interaction.response.is_done():
            try:
                await interaction.response.send_message(f"Операция отклонена: {error}", ephemeral=True)
            except:
                pass

    bot.tree.on_error = global_tree_error