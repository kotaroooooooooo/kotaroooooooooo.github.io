import sqlite3
import glob

OUTPUT_DB = "anime_merged.db"

tables = [
    "anime",
    "characters",
    "voice_actors",
    "character_voice_actor"
]

target = sqlite3.connect(OUTPUT_DB)
tcur = target.cursor()

for db in glob.glob("*.db"):
    if db == OUTPUT_DB:
        continue

    print(f"Importiere {db}...")

    source = sqlite3.connect(db)
    scur = source.cursor()

    for table in tables:
        rows = scur.execute(f"SELECT * FROM {table}").fetchall()

        if rows:
            placeholders = ",".join("?" * len(rows[0]))
            tcur.executemany(
                f"INSERT OR IGNORE INTO {table} VALUES ({placeholders})",
                rows
            )

    source.close()
    target.commit()

target.close()

print("Fertig!")