import aiosqlite
from config import DB_PATH
from utils import utc_now_iso

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''CREATE TABLE IF NOT EXISTS posts (
            doc_number TEXT PRIMARY KEY, faction TEXT, description TEXT, notified_person TEXT,
            forum_link TEXT, leader_text TEXT, deputy_text TEXT, author_id INTEGER,
            author_display_name TEXT, author_username TEXT, author_mention TEXT,
            created_at TEXT, expires_at TEXT
        )''')
        await db.execute('''CREATE TABLE IF NOT EXISTS wanteds (
            wanted_number TEXT PRIMARY KEY, fio TEXT, passport TEXT, article TEXT, 
            term_text TEXT, forum_link TEXT, message_id INTEGER, announced_by_id INTEGER,
            announced_by_display_name TEXT, announced_by_username TEXT,
            announced_by_avatar_url TEXT, created_at TEXT, closed_at TEXT, 
            closed_by TEXT, evidence_link TEXT
        )''')
        await db.execute('''CREATE TABLE IF NOT EXISTS fines (
            fine_number TEXT PRIMARY KEY, faction TEXT, fio TEXT, passport TEXT,
            article TEXT, amount TEXT, payment_deadline_text TEXT, due_at TEXT,
            created_by_id INTEGER, created_by_display_name TEXT, created_by_username TEXT,
            created_by_mention TEXT, created_at TEXT, paid_at TEXT, paid_by TEXT,
            overdue_notified INTEGER NOT NULL DEFAULT 0
        )''')
        await db.commit()

async def fetch_post(doc_number):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM posts WHERE doc_number = ?", (doc_number,)) as c: return await c.fetchone()

async def fetch_wanted(number):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM wanteds WHERE wanted_number = ?", (number,)) as c: return await c.fetchone()

async def fetch_fine(fine_number):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM fines WHERE fine_number = ?", (fine_number,)) as c: return await c.fetchone()

async def save_post(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        cols = ', '.join(data.keys())
        placeholders = ', '.join('?' for _ in data)
        await db.execute(f"INSERT INTO posts ({cols}) VALUES ({placeholders})", tuple(data.values()))
        await db.commit()

async def save_wanted(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        cols = ', '.join(data.keys())
        placeholders = ', '.join('?' for _ in data)
        await db.execute(f"INSERT INTO wanteds ({cols}) VALUES ({placeholders})", tuple(data.values()))
        await db.commit()

async def save_fine(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        cols = ', '.join(data.keys())
        placeholders = ', '.join('?' for _ in data)
        await db.execute(f"INSERT INTO fines ({cols}) VALUES ({placeholders})", tuple(data.values()))
        await db.commit()

async def close_wanted(number, closed_by, evidence_link):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE wanteds SET closed_at = ?, closed_by = ?, evidence_link = ? WHERE wanted_number = ?",
                         (utc_now_iso(), closed_by, evidence_link, number))
        await db.commit()

async def mark_fine_paid(fine_number, paid_by):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE fines SET paid_at = ?, paid_by = ? WHERE fine_number = ?",
                         (utc_now_iso(), paid_by, fine_number))
        await db.commit()

async def fetch_overdue_fines(current_time_iso):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM fines WHERE paid_at IS NULL AND overdue_notified = 0 AND due_at <= ?", (current_time_iso,)) as c:
            return await c.fetchall()

async def mark_fine_overdue_notified(fine_number):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE fines SET overdue_notified = 1 WHERE fine_number = ?", (fine_number,))
        await db.commit()

async def cleanup_expired_posts(current_time_iso):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM posts WHERE expires_at <= ?", (current_time_iso,))
        await db.commit()