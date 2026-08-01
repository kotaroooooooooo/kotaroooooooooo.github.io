"""
j2sqlite_merge.py

Führt zwei AniList-JSON-Exports zusammen und schreibt sie additiv in die
SQLite-Datenbank:

  - *_anime.json         -> Anime-Metadaten (Titel)
  - *_character_va.json  -> Charaktere + Synchronsprecher (+ deren Zuordnung)

Im Unterschied zum alten Skript (j2sqlite_character.py):
  - liest ZWEI Dateien statt einer und merged sie über die Anime-ID
  - löscht die Tabellen NICHT mehr bei jedem Lauf (CREATE TABLE IF NOT EXISTS),
    sondern fügt neue Jahre/Seiten additiv hinzu (INSERT OR REPLACE), so bleibt
    z.B. anime_merged.db über mehrere Jahrgänge hinweg erhalten
  - findet Dateien automatisch per Namenskonvention (*_anime.json /
    *_character_va.json), man kann sie aber auch explizit angeben
  - anime-Tabelle enthält jetzt zusätzlich Detail-Felder (format, status,
    season, season_year, episodes, duration, average_score, popularity,
    favourites, source, country_of_origin, description, site_url,
    cover_image, banner_image). Bei einer bereits bestehenden DB werden diese
    Spalten automatisch per ALTER TABLE nachgerüstet (migrate_anime_table),
    bestehende Zeilen/Daten gehen dabei nicht verloren.

Nutzung:
    # automatisch alle passenden Dateien im aktuellen Ordner einlesen
    python3 j2sqlite_merge.py

    # gezielt einzelne Dateien / eine andere DB angeben
    python3 j2sqlite_merge.py --anime 2025_anime.json --char-va 2025_character_va.json --db anime_merged.db

    # mehrere Jahrgänge auf einmal mergen
    python3 j2sqlite_merge.py --anime 2023_anime.json 2024_anime.json 2025_anime.json \\
                               --char-va 2023_character_va.json 2024_character_va.json 2025_character_va.json
"""

import argparse
import glob
import json
import sqlite3

DB_FILE_DEFAULT = "anime_merged.db"

# Spalten der anime-Tabelle über die Basisfelder hinaus: (Spaltenname, SQL-Typ)
# Wird sowohl fürs initiale CREATE TABLE als auch für die Migration bestehender
# Datenbanken (ALTER TABLE ADD COLUMN) verwendet.
ANIME_DETAIL_COLUMNS = [
    ("format", "TEXT"),
    ("status", "TEXT"),
    ("season", "TEXT"),
    ("season_year", "INTEGER"),
    ("episodes", "INTEGER"),
    ("duration", "INTEGER"),
    ("average_score", "INTEGER"),
    ("popularity", "INTEGER"),
    ("favourites", "INTEGER"),
    ("source", "TEXT"),
    ("country_of_origin", "TEXT"),
    ("description", "TEXT"),
    ("site_url", "TEXT"),
    ("cover_image", "TEXT"),
    ("banner_image", "TEXT"),
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
    anime_id INTEGER,
    full_name TEXT,
    native_name TEXT,
    role TEXT,
    image TEXT,
    FOREIGN KEY(anime_id) REFERENCES anime(id)
);

CREATE TABLE IF NOT EXISTS voice_actors (
    id INTEGER PRIMARY KEY,
    full_name TEXT,
    native_name TEXT,
    image TEXT
);

CREATE TABLE IF NOT EXISTS character_voice_actor (
    character_id INTEGER,
    voice_actor_id INTEGER,
    PRIMARY KEY(character_id, voice_actor_id)
);
"""


def migrate_anime_table(cursor):
    """Fügt neue Detail-Spalten zu einer bereits bestehenden anime-Tabelle hinzu,
    falls sie (z.B. aus einer älteren DB-Version) noch fehlen. Bestehende Zeilen
    bleiben erhalten, neue Spalten sind zunächst NULL bis sie neu importiert werden."""
    cursor.execute("PRAGMA table_info(anime)")
    existing_columns = {row[1] for row in cursor.fetchall()}

    for col_name, col_type in ANIME_DETAIL_COLUMNS:
        if col_name not in existing_columns:
            cursor.execute(f"ALTER TABLE anime ADD COLUMN {col_name} {col_type}")


def load_media(json_files):
    """Liest eine oder mehrere AniList-Page-JSON-Dateien ein und merged ihre
    'media'-Listen zu einem Dict {anime_id: media_object}, dedupliziert nach id."""
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
            """
            INSERT OR REPLACE INTO anime (
                id, romaji_title, english_title, native_title,
                format, status, season, season_year, episodes, duration,
                average_score, popularity, favourites, source, country_of_origin,
                description, site_url, cover_image, banner_image
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                anime_id,
                title.get("romaji"),
                title.get("english"),
                title.get("native"),
                anime.get("format"),
                anime.get("status"),
                anime.get("season"),
                anime.get("seasonYear"),
                anime.get("episodes"),
                anime.get("duration"),
                anime.get("averageScore"),
                anime.get("popularity"),
                anime.get("favourites"),
                anime.get("source"),
                anime.get("countryOfOrigin"),
                anime.get("description"),
                anime.get("siteUrl"),
                cover_image.get("extraLarge"),
                anime.get("bannerImage"),
            ),
        )
    return len(anime_media)


def import_characters(cursor, cva_media):
    voice_actor_cache = set()
    character_count = 0
    va_count = 0
    link_count = 0

    for anime_id, anime in cva_media.items():
        edges = (anime.get("characters") or {}).get("edges") or []

        for edge in edges:
            character = edge.get("node") or {}
            if not character.get("id"):
                continue

            char_name = character.get("name") or {}
            char_image = character.get("image") or {}

            cursor.execute(
                """
                INSERT OR REPLACE INTO characters
                    (id, anime_id, full_name, native_name, role, image)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    character["id"],
                    anime_id,
                    char_name.get("full"),
                    char_name.get("native"),
                    edge.get("role"),
                    char_image.get("large"),
                ),
            )
            character_count += 1

            for va in edge.get("voiceActors") or []:
                if not va.get("id"):
                    continue

                if va["id"] not in voice_actor_cache:
                    va_name = va.get("name") or {}
                    va_image = va.get("image") or {}
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO voice_actors (id, full_name, native_name, image)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            va["id"],
                            va_name.get("full"),
                            va_name.get("native"),
                            va_image.get("large"),
                        ),
                    )
                    voice_actor_cache.add(va["id"])
                    va_count += 1

                cursor.execute(
                    """
                    INSERT OR IGNORE INTO character_voice_actor (character_id, voice_actor_id)
                    VALUES (?, ?)
                    """,
                    (character["id"], va["id"]),
                )
                link_count += 1

    return character_count, va_count, link_count


def main():
    parser = argparse.ArgumentParser(description="Merged anime.json + character_va.json in die SQLite-DB.")
    parser.add_argument("--anime", nargs="+", default=None,
                         help="Ein oder mehrere *_anime.json Dateien (Default: alle *_anime.json im Ordner)")
    parser.add_argument("--char-va", nargs="+", default=None,
                         help="Ein oder mehrere *_character_va.json Dateien (Default: alle *_character_va.json im Ordner)")
    parser.add_argument("--db", default=DB_FILE_DEFAULT, help=f"Ziel-Datenbank (Default: {DB_FILE_DEFAULT})")
    args = parser.parse_args()

    anime_files = args.anime or sorted(glob.glob("*_anime.json"))
    cva_files = args.char_va or sorted(glob.glob("*_character_va.json"))

    if not anime_files:
        raise SystemExit("Keine *_anime.json Dateien gefunden. Mit --anime explizit angeben.")
    if not cva_files:
        raise SystemExit("Keine *_character_va.json Dateien gefunden. Mit --char-va explizit angeben.")

    print("Anime-Dateien:     ", anime_files)
    print("Character/VA-Dateien:", cva_files)

    conn = sqlite3.connect(args.db)
    cursor = conn.cursor()
    cursor.executescript(SCHEMA)
    migrate_anime_table(cursor)

    anime_media = load_media(anime_files)
    n_anime = import_anime(cursor, anime_media)

    cva_media = load_media(cva_files)
    n_chars, n_vas, n_links = import_characters(cursor, cva_media)

    conn.commit()
    conn.close()

    print(f"Fertig! {n_anime} Anime, {n_chars} Charakter-Einträge, {n_vas} neue Synchronsprecher, "
          f"{n_links} Verknüpfungen -> {args.db}")


if __name__ == "__main__":
    main()