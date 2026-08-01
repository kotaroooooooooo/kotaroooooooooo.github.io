import json
import sqlite3

JSON_FILE = "2023.json"
DB_FILE = "anime.db"

# Verbindung herstellen
conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()

# Alte Tabellen löschen
cursor.executescript("""
DROP TABLE IF EXISTS anime;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS voice_actors;
DROP TABLE IF EXISTS character_voice_actor;
""")

# Tabellen erstellen
cursor.executescript("""
CREATE TABLE anime (
    id INTEGER PRIMARY KEY,
    romaji_title TEXT,
    english_title TEXT,
    native_title TEXT
);

CREATE TABLE characters (
    id INTEGER PRIMARY KEY,
    anime_id INTEGER,
    full_name TEXT,
    native_name TEXT,
    role TEXT,
    image TEXT,
    FOREIGN KEY(anime_id) REFERENCES anime(id)
);

CREATE TABLE voice_actors (
    id INTEGER PRIMARY KEY,
    full_name TEXT,
    native_name TEXT,
    image TEXT
);

CREATE TABLE character_voice_actor (
    character_id INTEGER,
    voice_actor_id INTEGER,
    PRIMARY KEY(character_id, voice_actor_id)
);
""")

# JSON laden
with open(JSON_FILE, "r", encoding="utf-8") as f:
    data = json.load(f)

media_list = data["data"]["Page"]["media"]

voice_actor_cache = set()

for anime in media_list:

    anime_id = anime["id"]

    title = anime.get("title", {})

    cursor.execute("""
        INSERT INTO anime
        VALUES (?, ?, ?, ?)
    """, (
        anime_id,
        title.get("romaji"),
        title.get("english"),
        title.get("native")
    ))

    for edge in anime["characters"]["edges"]:

        character = edge["node"]

        cursor.execute("""
            INSERT OR REPLACE INTO characters
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            character["id"],
            anime_id,
            character["name"]["full"],
            character["name"]["native"],
            edge["role"],
            character["image"]["large"]
        ))

        for va in edge["voiceActors"]:

            if va["id"] not in voice_actor_cache:

                cursor.execute("""
                    INSERT INTO voice_actors
                    VALUES (?, ?, ?, ?)
                """, (
                    va["id"],
                    va["name"]["full"],
                    va["name"]["native"],
                    va["image"]["large"]
                ))

                voice_actor_cache.add(va["id"])

            cursor.execute("""
                INSERT OR IGNORE INTO character_voice_actor
                VALUES (?, ?)
            """, (
                character["id"],
                va["id"]
            ))

conn.commit()
conn.close()

print("Fertig! Datenbank erstellt:", DB_FILE)
