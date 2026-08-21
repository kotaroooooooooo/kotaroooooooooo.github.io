"""
j2sqlite_merge.py (Final Optimized Edition)

Führt AniList-JSON-Exports zusammen und speichert sie additiv in SQLite.
- FK-Enforcement aktiviert
- UPSERT-Strategie für alle Entitätstabellen (anime, characters, voice_actors)
- Zähler basieren auf cursor.rowcount (zählt neu + aktualisiert)
- Keine In-Memory-Caches, DB-ebene Deduplizierung
"""

import argparse
import glob
import json
import sqlite3

DB_FILE_DEFAULT = "anime_merged.db"

ANIME_DETAIL_COLUMNS = [
    ("format", "TEXT"), ("status", "TEXT"), ("season", "TEXT"), ("season_year", "INTEGER"),
    ("episodes", "INTEGER"), ("duration", "INTEGER"), ("average_score", "INTEGER"),
    ("popularity", "INTEGER"), ("favourites", "INTEGER"), ("source", "TEXT"),
    ("country_of_origin", "TEXT"), ("description", "TEXT"), ("site_url", "TEXT"),
    ("cover_image", "TEXT"), ("banner_image", "TEXT"),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS anime (
    id INTEGER PRIMARY KEY,
    romaji_title TEXT,
    english_title TEXT,
    native_title TEXT
);

CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    full_name TEXT,
    native_name TEXT,
    image TEXT
);

CREATE TABLE IF NOT EXISTS voice_actors (
    id INTEGER PRIMARY KEY,
    full_name TEXT,
    native_name TEXT,
    image TEXT
);

CREATE TABLE IF NOT EXISTS character_anime (
    character_id INTEGER,
    anime_id INTEGER,
    role TEXT,
    PRIMARY KEY(character_id, anime_id),
    FOREIGN KEY(character_id) REFERENCES characters(id),
    FOREIGN KEY(anime_id) REFERENCES anime(id)
);

CREATE TABLE IF NOT EXISTS character_anime_voice_actor (
    character_id INTEGER,
    anime_id INTEGER,
    voice_actor_id INTEGER,
    PRIMARY KEY(character_id, anime_id, voice_actor_id),
    FOREIGN KEY(character_id) REFERENCES characters(id),
    FOREIGN KEY(anime_id) REFERENCES anime(id),
    FOREIGN KEY(voice_actor_id) REFERENCES voice_actors(id)
);
"""


INDEXES = """
CREATE INDEX IF NOT EXISTS idx_ca_character   ON character_anime(character_id);
CREATE INDEX IF NOT EXISTS idx_ca_anime       ON character_anime(anime_id);
CREATE INDEX IF NOT EXISTS idx_cava_va        ON character_anime_voice_actor(voice_actor_id);
CREATE INDEX IF NOT EXISTS idx_cava_character ON character_anime_voice_actor(character_id);
CREATE INDEX IF NOT EXISTS idx_cava_anime     ON character_anime_voice_actor(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_season   ON anime(season, season_year);
CREATE INDEX IF NOT EXISTS idx_char_name      ON characters(full_name);
CREATE INDEX IF NOT EXISTS idx_va_name        ON voice_actors(full_name);
"""

def migrate_anime_table(cursor):
    cursor.execute("PRAGMA table_info(anime)")
    existing_columns = {row[1] for row in cursor.fetchall()}
    for col_name, col_type in ANIME_DETAIL_COLUMNS:
        if col_name not in existing_columns:
            cursor.execute(f"ALTER TABLE anime ADD COLUMN {col_name} {col_type}")


def load_media(json_files):
    media_by_id = {}
    for path in json_files:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        media_list = data["data"]["Page"]["media"]
        for media in media_list:
            media_by_id[media["id"]] = media
    return media_by_id


def import_anime(cursor, anime_media):
    for anime_id, anime in anime_media.items():
        title = anime.get("title") or {}
        cover_image = anime.get("coverImage") or {}

        cursor.execute(
            """INSERT INTO anime (
                id, romaji_title, english_title, native_title,
                format, status, season, season_year, episodes, duration,
                average_score, popularity, favourites, source, country_of_origin,
                description, site_url, cover_image, banner_image
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                romaji_title = excluded.romaji_title,
                english_title = excluded.english_title,
                native_title = excluded.native_title,
                format = excluded.format,
                status = excluded.status,
                season = excluded.season,
                season_year = excluded.season_year,
                episodes = excluded.episodes,
                duration = excluded.duration,
                average_score = excluded.average_score,
                popularity = excluded.popularity,
                favourites = excluded.favourites,
                source = excluded.source,
                country_of_origin = excluded.country_of_origin,
                description = excluded.description,
                site_url = excluded.site_url,
                cover_image = excluded.cover_image,
                banner_image = excluded.banner_image""",
            (
                anime_id,
                title.get("romaji"), title.get("english"), title.get("native"),
                anime.get("format"), anime.get("status"), anime.get("season"),
                anime.get("seasonYear"), anime.get("episodes"), anime.get("duration"),
                anime.get("averageScore"), anime.get("popularity"), anime.get("favourites"),
                anime.get("source"), anime.get("countryOfOrigin"), anime.get("description"),
                anime.get("siteUrl"), cover_image.get("extraLarge"), anime.get("bannerImage"),
            ),
        )
    return len(anime_media)


def import_characters(cursor, cva_media):
    character_count = 0
    va_count = 0
    link_count = 0
    char_anime_count = 0

    for anime_id, anime in cva_media.items():
        edges = (anime.get("characters") or {}).get("edges") or []

        for edge in edges:
            character = edge.get("node") or {}
            if not character.get("id"):
                continue

            char_name = character.get("name") or {}
            char_image = character.get("image") or {}

            # 1. Charakter global (UPSERT: aktualisiert Namen/Bilder automatisch)
            cursor.execute(
                """INSERT INTO characters (id, full_name, native_name, image)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                       full_name = excluded.full_name,
                       native_name = excluded.native_name,
                       image = excluded.image""",
                (character["id"], char_name.get("full"), char_name.get("native"), char_image.get("large"))
            )
            if cursor.rowcount > 0:
                character_count += 1

            # 2. Anime-Zuordnung + Rolle
            cursor.execute(
                """INSERT OR IGNORE INTO character_anime (character_id, anime_id, role) VALUES (?, ?, ?)""",
                (character["id"], anime_id, edge.get("role"))
            )
            if cursor.rowcount > 0:
                char_anime_count += 1

            # 3. Voice Actors & medien-spezifisches Mapping
            for va in edge.get("voiceActors") or []:
                if not va.get("id"):
                    continue

                va_name = va.get("name") or {}
                va_image = va.get("image") or {}

                # VA einfügen/aktualisieren (UPSERT)
                cursor.execute(
                    """INSERT INTO voice_actors (id, full_name, native_name, image)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET
                           full_name = excluded.full_name,
                           native_name = excluded.native_name,
                           image = excluded.image""",
                    (va["id"], va_name.get("full"), va_name.get("native"), va_image.get("large"))
                )
                if cursor.rowcount > 0:
                    va_count += 1

                # Medien-spezifische VA-Verknüpfung
                cursor.execute(
                    """INSERT OR IGNORE INTO character_anime_voice_actor 
                       (character_id, anime_id, voice_actor_id) VALUES (?, ?, ?)""",
                    (character["id"], anime_id, va["id"])
                )
                if cursor.rowcount > 0:
                    link_count += 1

    return character_count, va_count, link_count, char_anime_count


def main():
    parser = argparse.ArgumentParser(description="Merged anime.json + character_va.json in die SQLite-DB.")
    parser.add_argument("--anime", nargs="+", default=None, help="Ein oder mehrere *_anime.json Dateien")
    parser.add_argument("--char-va", nargs="+", default=None, help="Ein oder mehrere *_character_va.json Dateien")
    parser.add_argument("--db", default=DB_FILE_DEFAULT, help=f"Ziel-Datenbank (Default: {DB_FILE_DEFAULT})")
    args = parser.parse_args()

    anime_files = args.anime or sorted(glob.glob("*_anime.json"))
    cva_files = args.char_va or sorted(glob.glob("*_character_va.json"))

    if not anime_files:
        raise SystemExit("Keine *_anime.json Dateien gefunden.")
    if not cva_files:
        raise SystemExit("Keine *_character_va.json Dateien gefunden.")

    print("Anime-Dateien:      ", anime_files)
    print("Character/VA-Dateien:", cva_files)

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")  # FK-Enforcement aktivieren
    cursor = conn.cursor()
    cursor.executescript(SCHEMA)
    migrate_anime_table(cursor)
    cursor.executescript(INDEXES)  # idempotent — safe on every run

    anime_media = load_media(anime_files)
    n_anime = import_anime(cursor, anime_media)

    cva_media = load_media(cva_files)
    n_chars, n_vas, n_links, n_char_anime = import_characters(cursor, cva_media)

    conn.commit()
    conn.close()

    print(f"Fertig! {n_anime} Anime verarbeitet, {n_chars} Charaktere (neu/aktualisiert), "
          f"{n_vas} VAs (neu/aktualisiert), {n_links} VA-Links, {n_char_anime} Charakter-Anime-Zuordnungen -> {args.db}")


if __name__ == "__main__":
    main()