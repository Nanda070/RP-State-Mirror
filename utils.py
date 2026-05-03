import discord
import re
from datetime import datetime, timezone, timedelta
from config import BOT_FOOTER_ICON

LINK_RE = re.compile(r"^https?://", re.IGNORECASE)

def utc_now(): return datetime.now(timezone.utc)
def utc_now_iso(): return utc_now().isoformat()
def footer_text(): return f"Бот Discord | {datetime.now().astimezone().strftime('%d.%m.%Y %H:%M:%S')}"
def safe_avatar_url(user): return getattr(user.display_avatar, 'url', BOT_FOOTER_ICON) if user and hasattr(user, 'display_avatar') and user.display_avatar else BOT_FOOTER_ICON
def discord_identity(display_name, username): return f"{display_name} ({username})"

def normalize_link_or_text(value):
    value = str(value or "").strip()
    if not value: return "Не указано"
    if LINK_RE.match(value): return f"[Открыть]({value})"
    return value

def parse_duration(value: str) -> timedelta:
    match = re.fullmatch(r"(\d+)([mh])", value.strip().lower())
    if not match: raise ValueError("Формат: 1m, 24h")
    amt, unit = int(match.group(1)), match.group(2)
    return timedelta(minutes=amt) if unit == "m" else timedelta(hours=amt)

async def send_via_webhook(session, webhook_url, embed=None, content=None, username=None, avatar_url=None, wait=False):
    webhook = discord.Webhook.from_url(webhook_url, session=session)
    return await webhook.send(
        content=content, embed=embed, username=username, avatar_url=avatar_url, wait=wait,
        allowed_mentions=discord.AllowedMentions(roles=True, users=True, everyone=False)
    )

def allowed_by_roles(member, allowed_role_ids):
    if not allowed_role_ids: return True
    return any(r.id in allowed_role_ids for r in member.roles)