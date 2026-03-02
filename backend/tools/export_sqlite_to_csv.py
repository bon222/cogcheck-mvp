import csv
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "cogcheck.db"
EXPORT_DIR = ROOT / "exports"
TABLES = ["users", "sessions", "attempts", "raw_events", "labels"]


def export_table(conn: sqlite3.Connection, table: str, output_dir: Path) -> None:
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table}")
    rows = cursor.fetchall()
    headers = [col[0] for col in cursor.description]

    output_file = output_dir / f"{table}.csv"
    with output_file.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"{table}: {len(rows)} rows -> {output_file}")


def main() -> None:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        for table in TABLES:
            export_table(conn, table, EXPORT_DIR)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
