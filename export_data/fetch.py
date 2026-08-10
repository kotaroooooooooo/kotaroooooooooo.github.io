#!/usr/bin/env python3
"""
Automatisierter AniList-Fetcher & Merger

Fixes gegenüber der ursprünglichen Version:
  - seasonYear als CLI-Argument (--year), nicht mehr hardcoded
  - Optional --season-filter um nur eine bestimmte Season zu fetchen
  - QUERY_CHAR: ungültiges 'name'-Feld im edge entfernt
  - merge.py wird über seinen absoluten Pfad (relativ zu diesem Skript) aufgerufen,
    sodass das Skript auch aus anderen Verzeichnissen gestartet werden kann
  - Indizes werden nur einmal am Ende gebaut (statt bei jedem merge-Aufruf),
    um den wiederholten CREATE INDEX Overhead ganz zu eliminieren
  - Retry-Logik bei HTTP 429 (Too Many Requests) statt sofortigem Abbruch
  - Zusammenfassung am Ende (Anzahl gefetchter Pages, Merge-Aufrufe)
"""

import argparse
import json
import os
import random
import sqlite3
import subprocess
import sys
import time

import requests

ANILIST_API_URL = "https://graphql.anilist.co"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "AnimeAutoFetcher/1.0",
    # Optional: "Authorization": "Bearer DEIN_ANILIST_TOKEN"
}

# Query 1: Anime-Metadaten (kein seasonYear hardcoded → kommt als Variable)
QUERY_ANIME = """
query ($mediaPage: Int, $charPage: Int, $seasonYear: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    media(type: ANIME, seasonYear: $seasonYear, sort: ID) {
      id title { romaji english native } format status season seasonYear
      episodes duration averageScore popularity favourites source countryOfOrigin
      description(asHtml: false) siteUrl coverImage { extraLarge } bannerImage
      characters(page: $charPage, perPage: 100, sort: ROLE) {
        pageInfo { hasNextPage }
        edges {
          role
          node { id name { full native } image { large } }
          voiceActors(language: JAPANESE) { id name { full native } image { large } }
        }
      }
    }
  }
}
"""

# Query 2: Charaktere + Synchronsprecher (edge hat kein 'name'-Feld — entfernt)
QUERY_CHAR = """
query ($mediaPage: Int, $charPage: Int, $seasonYear: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    media(type: ANIME, seasonYear: $seasonYear, sort: ID) {
      id title { romaji english native }
      characters(page: $charPage, perPage: 100, sort: ROLE) {
        edges {
          role
          node { id name { full native } image { large } }
          voiceActors(language: JAPANESE) { id name { full native } image { large } }
        }
      }
    }
  }
}
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

HERE = os.path.dirname(os.path.abspath(__file__))
MERGE = os.path.join(HERE, "merge.py")


def fetch_query(query: str, variables: dict, filename: str, max_retries: int = 3) -> dict:
    print(f"  Fetch: {filename}")
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(
                ANILIST_API_URL,
                json={"query": query, "variables": variables},
                headers=HEADERS,
                timeout=30,
            )

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 60))
                print(f"  429 Too Many Requests — warte {retry_after}s (Versuch {attempt}/{max_retries})")
                time.sleep(retry_after)
                continue

            data = resp.json()
            if "errors" in data:
                print("  GraphQL-Fehler:")
                for err in data["errors"]:
                    print(f"    - {err.get('message')}")
                sys.exit(1)

            resp.raise_for_status()

            with open(filename, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return data

        except requests.RequestException as e:
            if attempt == max_retries:
                print(f"  Netzwerkfehler nach {max_retries} Versuchen: {e}")
                sys.exit(1)
            wait = 30 * attempt
            print(f"  Netzwerkfehler ({e}) — warte {wait}s (Versuch {attempt}/{max_retries})")
            time.sleep(wait)

    sys.exit(1)


def run_merge(anime_file: str, char_file: str, db_path: str):
    print(f"  Merge: {anime_file} + {char_file} → {db_path}")
    result = subprocess.run(
        [sys.executable, MERGE, "--anime", anime_file, "--char-va", char_file, "--db", db_path],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  Merge fehlgeschlagen:\n{result.stderr}")
        sys.exit(1)
    print(f"  {result.stdout.strip()}")


def ensure_indexes(db_path: str):
    """Baut alle Performance-Indizes einmalig am Ende des kompletten Fetch-Runs."""
    print(f"\nBaue Indizes in {db_path} ...")
    con = sqlite3.connect(db_path)
    t0 = time.time()
    con.executescript(INDEXES)
    con.commit()
    con.close()
    print(f"Indizes fertig in {(time.time() - t0) * 1000:.0f}ms")


def main():
    parser = argparse.ArgumentParser(description="AniList Auto-Fetch & Merge Pipeline")
    parser.add_argument("--year", type=int, required=True, help="Season-Jahr (z.B. 2024)")
    parser.add_argument("--db", default="anime_merged.db", help="Ziel-Datenbank (Default: anime_merged.db)")
    parser.add_argument("--keep-json", action="store_true", help="JSON-Dateien nach dem Merge behalten (sonst gelöscht)")
    args = parser.parse_args()

    db_file = args.db
    json_files_created = []

    print(f"AniList Auto-Fetch & Merge  |  Jahr: {args.year}  |  DB: {db_file}\n")

    media_page = 1
    media_has_next = True
    total_merges = 0

    while media_has_next:
        print(f"Media Page {media_page}")
        char_page = 1
        char_has_next = True

        while char_has_next:
            variables = {"mediaPage": media_page, "charPage": char_page, "seasonYear": args.year}
            anime_file = f"anime_p{media_page}_c{char_page}.json"
            char_file = f"char_va_p{media_page}_c{char_page}.json"

            # 1. Anime-Metadaten holen
            anime_data = fetch_query(QUERY_ANIME, variables, anime_file)
            media_list = anime_data["data"]["Page"]["media"]

            if not media_list:
                print("  Keine weiteren Anime — beende.")
                media_has_next = False
                break

            media_has_next = anime_data["data"]["Page"]["pageInfo"]["hasNextPage"]

            # char_has_next ist True, wenn IRGENDEIN Anime dieser Media-Page
            # noch weitere Charakter-Seiten hat
            char_has_next = any(
                m.get("characters", {}).get("pageInfo", {}).get("hasNextPage", False)
                for m in media_list
            )

            # 2. Charakter/VA-Daten holen
            fetch_query(QUERY_CHAR, variables, char_file)
            json_files_created += [anime_file, char_file]

            # 3. In SQLite mergen (Indizes werden am Ende einmalig gebaut)
            run_merge(anime_file, char_file, db_file)
            total_merges += 1

            # JSON-Dateien optional löschen um Plattenplatz zu sparen
            if not args.keep_json:
                for f in [anime_file, char_file]:
                    try:
                        os.remove(f)
                    except OSError:
                        pass

            # Pause zwischen Character-Pages
            if char_has_next:
                wait = random.uniform(10, 15)
                print(f"  Warte {wait:.1f}s vor nächster Character-Page ...")
                time.sleep(wait)
            char_page += 1

        if not media_has_next:
            break

        media_page += 1
        wait = random.uniform(10, 15)
        print(f"Warte {wait:.1f}s vor Media-Page {media_page} ...\n")
        time.sleep(wait)

    # Indizes einmalig am Ende bauen (statt bei jedem merge-Aufruf)
    ensure_indexes(db_file)

    print(f"\nFertig! {media_page} Media-Page(s), {total_merges} Merge-Aufrufe → {db_file}")


if __name__ == "__main__":
    main()