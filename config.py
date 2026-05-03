import os
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_BOT_TOKEN")
MAIN_SERVER_ID = int(os.getenv("MAIN_SERVER_ID", 0))
LOG_CHANNEL_ID = int(os.getenv("LOG_CHANNEL_ID", 0))
FINE_NOTIFY_CHANNEL_ID = int(os.getenv("FINE_NOTIFY_CHANNEL_ID", 0))
DB_PATH = os.getenv("DB_PATH", "bot_data.sqlite3")
BOT_FOOTER_ICON = os.getenv("BOT_FOOTER_ICON", "")

COMMAND_GUILD_IDS = [int(x.strip()) for x in os.getenv("COMMAND_GUILD_IDS", "").split(",") if x.strip().isdigit()]
WANTED_WEBHOOK = os.getenv("WANTED_WEBHOOK")
RESPONSE_WEBHOOK = os.getenv("RESPONSE_WEBHOOK")

WANTED_SERVER_ID = int(os.getenv("WANTED_SERVER_ID", 0) or 0)
WANTED_CHANNEL_ID = int(os.getenv("WANTED_CHANNEL_ID", 0) or 0)

def _parse_ids(key):
    val = os.getenv(key, "")
    return [int(x.strip()) for x in val.split(",") if x.strip().isdigit()]

POST_ALLOWED_ROLE_IDS = _parse_ids("POST_ALLOWED_ROLE_IDS")
WANTED_ALLOWED_ROLE_IDS = _parse_ids("WANTED_ALLOWED_ROLE_IDS")
FINE_ALLOWED_ROLE_IDS = _parse_ids("FINE_ALLOWED_ROLE_IDS")
WANTED_PING_ROLES = _parse_ids("WANTED_PING_ROLES")
FINE_OVERDUE_PING_ROLES = _parse_ids("FINE_OVERDUE_PING_ROLES")
EXCLUDED_MAIN_ROLE_IDS = _parse_ids("EXCLUDED_MAIN_ROLE_IDS")

FACTION_NAMES = ["FIB", "ARMY", "SASPA", "LSPD", "GOV", "EMS", "LSSD"]
FACTIONS = {}

for f in FACTION_NAMES:
    s_id = int(os.getenv(f"{f}_SERVER_ID", 0))
    if s_id:
        m_role = int(os.getenv(f"{f}_MAIN_ROLE_ID", 0))
        FACTIONS[f] = {
            "server_id": s_id,
            "faction_role_id": int(os.getenv(f"{f}_ROLE_ID", 0)),
            "main_role_id": m_role,
            "leader_role_id": int(os.getenv(f"{f}_LEADER_ROLE_ID", m_role) or m_role),
            "webhook": os.getenv(f"{f}_WEBHOOK")
        }

COLOR_DEFAULT = 0x8989A8
COLOR_RESPONSE = 0x8B6F47
COLOR_WANTED = 0x6E6B73
COLOR_WANTED_DONE = 0x5A8F63
COLOR_SUCCESS = 0x5A8F63
COLOR_ERROR = 0xA64B4B
COLOR_FINE = 0xB07A3F
COLOR_FINE_PAID = 0x5A8F63
COLOR_FINE_OVERDUE = 0xA64B4B