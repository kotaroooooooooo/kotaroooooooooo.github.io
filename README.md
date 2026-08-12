# AniVoice

AniVoice is a static website powered by an offline SQLite database generated from the public AniList GraphQL API.

The primary goal of this project is to provide a fast and searchable database for exploring relationships between anime, characters, and Japanese voice actors (Seiyuu). Instead of requesting data from the AniList API on every search, all information is stored locally in SQLite, allowing instant access without network latency or API rate limits.

---

## Features

* Offline SQLite database
* Static website (no backend required)
* Fast local searching
* Anime metadata
* Character database
* Japanese voice actor database
* Character ↔ Voice Actor relationships
* Cover, banner, character and voice actor images
* Easily expandable with additional AniList data

---

## Data Source

All data is collected from the public AniList GraphQL API using custom Python scripts.

The collected JSON data is merged into a local SQLite database, which is then used by the website.

Current datasets include:

* Anime
* Characters
* Japanese Voice Actors
* Character Roles
* Anime Metadata
* Images

---

## Mirror Progress

| Year | Anime | Game | Character | Voice Actors |
| :--: | :---: | :--: | :-------: | :----------: |
| 2026 |   ✓   |      |           |              |
| 2025 |   ✓   |      |           |              |
| 2024 |   ✓   |      |           |              |
| 2023 |   ✓   |      |           |              |
| 2022 |   ✓   |      |           |              |
| 2021 |   ✓   |      |           |              |
| 2020 |   ✓   |      |           |              |
| 2019 |   ✓   |      |           |              |
| 2018 |   ✓   |      |           |              |
| 2017 |   ✓   |      |           |              |
| 2016 |   ✓   |      |           |              |
| 2015 |   ✓   |      |           |              |
| 2014 |       |      |           |              |
| 2013 |       |      |           |              |
| 2012 |       |      |           |              |
| 2011 |       |      |           |              |
| 2010 |       |      |           |              |
| 2009 |       |      |           |              |
|  ... |  ...  |  ... |    ...    |      ...     |

---



python3 anilist_auto_fetch_merge.py --year 2024
python3 anilist_auto_fetch_merge.py --year 2023 --db anime_mergeds.db
python3 anilist_auto_fetch_merge.py --year 2025 --keep-json  # JSON-Dateien behalten




## GraphQL Queries

The database is generated using multiple GraphQL queries against the AniList API.

### Query 1: Anime Details + Characters

Retrieves anime metadata together with characters and their Japanese voice actors.

<details>
<summary>View GraphQL Query</summary>

```graphql
query ($mediaPage: Int, $charPage: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo {
      currentPage
      hasNextPage
    }

    media(type: ANIME, seasonYear: 2019) {
      id

      title {
        romaji
        english
        native
      }

      format
      status
      season
      seasonYear
      episodes
      duration
      averageScore
      popularity
      favourites
      source
      countryOfOrigin

      description(asHtml: false)

      siteUrl

      coverImage {
        extraLarge
      }

      bannerImage

      characters(page: $charPage, perPage: 100, sort: ROLE) {
        pageInfo {
          hasNextPage
        }

        edges {
          role

          node {
            id
            name {
              full
              native
            }
            image {
              large
            }
          }

          voiceActors(language: JAPANESE) {
            id
            name {
              full
              native
            }
            image {
              large
            }
          }
        }
      }
    }
  }
}
```

</details>

---

### Query 2: Character / Voice Actor Mirror

Optimized for collecting character and voice actor relationships.

<details>
<summary>View GraphQL Query</summary>

```graphql
query ($mediaPage: Int, $charPage: Int) {
  Page(page: $mediaPage, perPage: 50) {
    pageInfo {
      currentPage
      hasNextPage
    }

    media(type: ANIME, seasonYear: 2019, sort: ID) {
      id

      title {
        romaji
        english
        native
      }

      characters(page: $charPage, perPage: 100, sort: ROLE) {
        edges {
          role
          name

          node {
            id
            name {
              full
              native
            }
            image {
              large
            }
          }

          voiceActors(language: JAPANESE) {
            id
            name {
              full
              native
            }
            image {
              large
            }
          }
        }
      }
    }
  }
}
```

</details>


---

## Technology

* Python
* SQLite
* GraphQL
* AniList API
* HTML
* CSS
* JavaScript

---

## Roadmap

### Database

* [x] Anime metadata
* [ ] Complete character database
* [ ] Complete Japanese voice actor database
* [ ] Game support
* [ ] Staff database
* [ ] Studio database
* [ ] Genres and tags
* [ ] Statistics
* [ ] Automatic updater

### Website

* [ ] Anime search
* [ ] Character search
* [ ] Voice actor search
* [ ] Anime pages
* [ ] Character pages
* [ ] Voice actor pages
* [ ] Advanced filters
* [ ] Mobile optimization

---

## Disclaimer

AniVoice is an unofficial project and is not affiliated with AniList.

All data originates from the public AniList GraphQL API and is stored locally for offline browsing and research purposes.
