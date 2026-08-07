#!/usr/bin/env python3
"""
Automatisierter AniList-Fetcher & Merger
- ✅ Korrigierte GraphQL-Queries (perPage statt perPer)
- ✅ Zufällige Pause von 10-15s zwischen Requests (vermeidet 429)
- ✅ Pagination prüft hasNextPage über ALLE Anime der Seite (verhindert vorzeitigen Abbruch)
- ✅ Zeigt GraphQL-Fehler direkt an
"""

import requests
import json
import subprocess
import time
import sys
import random

ANILIST_API_URL = "https://graphql.anilist.co"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "AnimeAutoFetcher/1.0"
    # Optional: "Authorization": "Bearer DEIN_ANILIST_TOKEN"
}

# Query 1: Anime-Details + Characters
QUERY_ANIME = """
query ($mediaPage: Int, $charPage: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    media(type: ANIME, seasonYear: 2019) {
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

# Query 2: Fokussiert auf Characters/VA
QUERY_CHAR = """
query ($mediaPage: Int, $charPage: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo { currentPage hasNextPage }
    media(type: ANIME, seasonYear: 2019, sort: ID) {
      id title { romaji english native }
      characters(page: $charPage, perPage: 100, sort: ROLE) {
        edges {
          role name
          node { id name { full native } image { large } }
          voiceActors(language: JAPANESE) { id name { full native } image { large } }
        }
      }
    }
  }
}
"""

def fetch_query(query: str, variables: dict, filename: str) -> dict:
    print(f"  🌐 Fetch: {filename}")
    response = requests.post(ANILIST_API_URL, json={"query": query, "variables": variables}, headers=HEADERS, timeout=30)
    
    # GraphQL gibt oft 200 OK zurück, auch bei Syntaxfehlern -> Fehler im JSON prüfen
    data = response.json()
    if "errors" in data:
        print(f"  ❌ GraphQL Error(s):")
        for err in data["errors"]:
            print(f"     - {err.get('message')}")
        sys.exit(1)
        
    response.raise_for_status()
    
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data

def run_merge(anime_file: str, char_file: str, db_path: str):
    print(f"  🗃️  Merge: {anime_file} + {char_file} → {db_path}")
    result = subprocess.run(
        [sys.executable, "mergee.py", "--anime", anime_file, "--char-va", char_file, "--db", db_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  ❌ Merge fehlgeschlagen:\n{result.stderr}")
        sys.exit(1)
    else:
        print(f"  ✅ {result.stdout.strip()}")

def main():
    db_file = "anime_mergeds.db"
    media_page = 1
    media_has_next = True

    print("🚀 Starte AniList Auto-Fetch & Merge Pipeline...\n")

    while media_has_next:
        print(f"📦 Media Page {media_page}")
        char_page = 1
        char_has_next = True

        while char_has_next:
            variables = {"mediaPage": media_page, "charPage": char_page}
            anime_file = f"anime_p{media_page}_c{char_page}.json"
            char_file = f"char_va_p{media_page}_c{char_page}.json"

            # 1. Anime-Query
            anime_data = fetch_query(QUERY_ANIME, variables, anime_file)
            media_list = anime_data["data"]["Page"]["media"]

            if not media_list:
                print("  ⚠️  Keine weiteren Anime gefunden. Beende Loop.")
                media_has_next = False
                break

            # Pagination-Flag für Media-Seiten
            media_has_next = anime_data["data"]["Page"]["pageInfo"]["hasNextPage"]

            # 🔍 KORREKTUR: hasNextPage über ALLE Anime der Seite prüfen
            # (Verschiedene Anime haben unterschiedlich viele Charaktere)
            char_has_next = False
            for m in media_list:
                char_info = m.get("characters", {}).get("pageInfo", {})
                if char_info.get("hasNextPage", False):
                    char_has_next = True
                    break

            # 2. Character-Query
            fetch_query(QUERY_CHAR, variables, char_file)

            # 3. In SQLite mergen
            run_merge(anime_file, char_file, db_file)

            # ⏳ Zufällige Pause 10-15s (vermeidet 429 Too Many Requests)
            wait_time = random.uniform(10, 15)
            print(f"  ⏳ Warte {wait_time:.1f}s vor nächster Character-Page...")
            time.sleep(wait_time)
            char_page += 1

        if not media_has_next:
            break
        media_page += 1
        print("⏳ Warte kurz vor nächster Media-Page...\n")
        time.sleep(random.uniform(10, 15))

    print("\n🎉 Alle Seiten erfolgreich verarbeitet und in die DB gemergt!")

if __name__ == "__main__":
    main()
