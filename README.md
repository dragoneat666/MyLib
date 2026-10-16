# MyLib

A self-hosted home library, like [Libib](https://www.libib.com/), where you own the data.

- **Collections** (e.g. *American Girl*, *Magic Tree House*), each with its own shelf of books
- **New & Unsorted**: new books land here (unless a collection is picked) until you move them into a collection
- **Add books** on the website by ISBN, title/author search, or by typing them in
- **Android app**: the same library on the phone, plus a camera mode that recognises a book
  from its **barcode** or from a photo of its **front cover**, and warns you if you already own it
- **Already own it?** When a book being added or imported is already in MyLib, you choose:
  *Replacement copy — retag it* (copy count stays, pick its tags), *Add 2nd copy*, or *Ignore*
- **Libib CSV import** (re-importing the same file is safe: books already imported from it are skipped, and
  your answers about second copies are remembered)
- **Tags** as a shared list: pick several at once, *Add tag* right after adding a book, a Tags section in the
  side menu, rename/merge/delete in Settings → Tags
- **Export** one collection or the whole library as CSV (Libib's format), or the whole database as SQL
- **Nightly backups**: `mylib_YYYY-MM-DD.sql` + `mylib_YYYY-MM-DD.csv` written to a folder on the host
- No logins (like PokeTracker): it's only reachable on the home network / NetBird
- Covers saved locally, reading status, ratings, notes, copies

One Docker container (Node.js + SQLite + the React web app). Images are built by GitHub Actions:
`ghcr.io/dragoneat666/mylib:latest`.

---

## Where does the book information come from?

Libib doesn't say publicly where its data comes from. Its records look like retail catalogue data
(Amazon-style titles such as *"Meet Rebecca (American Girl)"* and seller blurbs in some descriptions),
the kind of data sold by services such as **ISBNdb** or Amazon's product API.

MyLib uses these sources:

| Source | Cost / limit | What it adds | Setting |
|---|---|---|---|
| **Open Library** (Internet Archive) | free, no key | ISBN lookups, covers, series, search | always available |
| **Hardcover** | free token, 5,000 calls/day | series, descriptions, covers, search | `HARDCOVER_API_TOKEN` |
| **Google Books** | free key, 1,000 calls/day | good titles, descriptions, publishers | `GOOGLE_BOOKS_API_KEY` |
| **ISBNdb** | paid subscription | the most complete retail data | `ISBNDB_API_KEY` |
| **NYT Books** | free key, capped at 1,000 calls/day | marks NYT bestsellers (only knows bestseller lists and NYT reviews) | `NYT_API_KEY` |
| **Claude** (Anthropic) | pay per use (a few cents per cover photo) | reads cover photos to identify books | `ANTHROPIC_API_KEY` |

**How they're called:** for book details, the sources are asked **one at a time in the order set on the
Book sources page** (default: Open Library, Hardcover, Google Books, ISBNdb), stopping as soon as the book has
a title, author, cover and description. Each source can be switched off there and has a **Test** button.
MyLib counts every call and stops using a source for the rest of the day at its limit (`*_DAILY_LIMIT` in
`.env`), and pauses one that answers "too many requests". NYT is checked once per looked-up book (max 5 a
minute) and can tag bestsellers "NYT Bestseller". Goodreads can't be used: it stopped giving out API keys in 2020.

Getting keys:
- **Hardcover:** hardcover.app → Settings → *Hardcover API* → *New API Key* (copy it into `HARDCOVER_API_TOKEN`).
- **Google Books:** <https://console.cloud.google.com> → create a project → *APIs & Services → Library* → enable
  **Books API** → *Credentials → Create credentials → API key*.
- **NYT:** <https://developer.nytimes.com> → create an app with the **Books API** enabled.

Open Library alone finds most books; with no keys, it found covers for 24 of the 29 American Girl books in the sample export.

Each book also gets an **ISBN-13** and **ISBN-10** (one is calculated from the other when only one is
known). Different editions (hardcover, paperback, Beforever reprints…) have different ISBNs, so scanning
the barcode always gives you the exact edition on your shelf.

---

## Install on the Docker server (Dockge)

1. Create a folder, e.g. `C:\Docker\MyLib`, and put [`docker-compose.yml`](docker-compose.yml) and
   [`.env.example`](.env.example) in it. Copy `.env.example` to `.env` and fill it in (all keys are optional).
2. In Dockge, deploy the `MyLib` stack. The compose file joins the existing `denflix` network like your other stacks.
3. Open `http://<server>:14100`. Under **Settings → Book information sources**, press **Test** next to each
   source to check it works (e.g. that your Google Books key is valid).
4. **Import** her Libib CSV files (*Import* page). Tick *Download cover pictures* to fetch covers.

Updating: `docker compose pull && docker compose up -d` (or *Update* in Dockge) after the GitHub build goes green.

### Remote access (phone over NetBird)

MyLib listens on port **14100**. Over NetBird, use the server's NetBird IP: `http://100.x.y.z:14100`,
both in the phone's browser and in the Android app. NetBird encrypts the traffic, so plain `http` is fine.

MyLib has **no logins**, so don't publish it to the internet (no port forward or public reverse-proxy host).
Anyone who can reach port 14100 can change the library.

### Backups → Dropbox

Every night at 2:00 AM (set by `BACKUP_CRON`), MyLib writes to the backups folder (`BACKUP_PATH`, default `C:\Docker\MyLib\backups`):

```
mylib_2026-10-15.sql   full database dump (restore it on the Backups page, or: sqlite3 mylib.db < file.sql)
mylib_2026-10-15.csv   the whole library in Libib CSV format
```

Files are written under a temporary name and renamed when complete, so a copy script never picks up a
half-written file. Files older than `BACKUP_KEEP_DAYS` (default 30) are deleted. For your nightly batch file
(run it after 2:00 AM):

```bat
robocopy "C:\Docker\MyLib\backups" "%USERPROFILE%\Dropbox\Backups\MyLib" mylib_*.sql mylib_*.csv /MOV /R:2 /W:5
```

Cover images live in the `mylib_data` volume and aren't in the nightly files; they can be downloaded again
with **Select → Find covers**.

---

## Android app

**Install:** on the phone, open `http://<server>:14100/download/mylib.apk` (also linked in **Settings**), or download
`mylib.apk` from the [android-latest release](https://github.com/dragoneat666/MyLib/releases/tag/android-latest).
Allow installing from the browser when Android asks. Then enter the server address (the NetBird IP and port)
and tap **Connect**. To change it later: **Settings → Change server address** in the app.

The app shows the same library as the website. The orange **camera** button opens the scanner:

- **Barcode:** point at the barcode on the back. It's read automatically, the book is looked up, and
  you can **Add** it (or **+1 copy** if you already have it). Then it goes straight back to scanning,
  so you can work through a stack of books.
- **Cover:** point at the front cover and hold still, or tap the round button. The phone reads the
  title and author and the server finds matching books. If the text was misread, fix the words in the
  search box on the results sheet. With `ANTHROPIC_API_KEY` set, the photo itself is identified, which
  works much better for covers with stylised titles.
- "**Adding to**" starts on **New & Unsorted** (or on the collection you opened the scanner from) and stays on
  whatever you pick until you close the scanner. **Type it in** opens the manual form.
- **Tag every book I scan** puts the chosen tags (e.g. "Garage sale") on every book added in that session.
- After each book, the "Added …" message has an **Add tag** button. If the book is already in MyLib you get
  *Replacement copy — retag it*, *Add 2nd copy* or *Ignore*.

### Signing key (one-time setup)

Android only installs an update over an older version when both are signed with the same key. The key
lives outside the repo, in `C:\Code\mylib-signing` (see `README.txt` there). Add the four
`ANDROID_*` secrets it lists to the GitHub repo. Without them, CI signs with a throwaway key and every
update needs an uninstall first.

---

## Development

```
server/   Express API + SQLite (better-sqlite3), metadata lookups, backups      → npm test
web/      React (Vite) web app                                                  → npm run dev
android/  Kotlin app: WebView + CameraX + ML Kit barcode/text scanner          → ./gradlew assembleDebug
```

Run locally: `cd server && DATA_DIR=./data BACKUP_DIR=./backups PORT=3099 WEB_DIR=../web/dist node src/index.js`,
and `cd web && npm run dev` (proxies `/api` to port 3099).

Settings (environment variables): `PORT` (3000), `DATA_DIR` (/data), `BACKUP_DIR` (/backups), `BACKUP_CRON`,
`BACKUP_KEEP_DAYS`, `TZ`, `GOOGLE_BOOKS_API_KEY`, `ISBNDB_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
(default `claude-opus-5-5`), `TRUST_PROXY`.
