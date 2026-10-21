# Suara Bersama (Edisi Klebang Boyz) (`klebang.boyz.space`)

A responsive community update hub hosted on **GitHub Pages** built strictly for **Facebook RSS feed ingestion and global hashtag filtering**, styled with the aesthetics of **[bersama.org/ms](https://bersama.org/ms)**.

---

## ⚙️ 1. Ultra-Clean Global Configuration (`config.json`)

`config.json` is the **single source of truth** for site configuration. Simply list the Facebook profiles you want to pull from and the hashtags you want to filter:

```json
{
  "siteName": "KLEBANG BOYZ SPACE",
  "profiles": [
    {
      "name": "Dr Bryan Kek",
      "url": "https://www.facebook.com/drbryankek"
    },
    {
      "name": "Jom Bersama Ethan",
      "url": "https://www.facebook.com/JomBersamaEthan"
    },
    {
      "name": "Parti Bersama Melaka",
      "url": "https://www.facebook.com/profile.php?id=61592803485635"
    },
    {
      "name": "Bersama Gohan",
      "url": "https://www.facebook.com/Bersamagohan"
    }
  ],
  "hashtags": [
    "#feed",
    "#JomBersamaEthan",
    "#klebang"
  ]
}
```

### Strictly Client-Sided RSSHub Ingestion
The site uses [RSSHub (DIYgod/RSSHub)](https://github.com/DIYgod/RSSHub) purely from client-side JavaScript in the browser:
- Dynamically resolves Facebook Page IDs from the URLs in `config.json`.
- Seamless client-side CORS proxy cascade (`allorigins.win`) for static GitHub Pages hosting.
- Preserves full post formatting (paragraph breaks, linebreaks, bold text).
- Detects video clips and embeds responsive Facebook players without clipping.
- Instant render of verified feed items from `data/feed.json` with background live synchronization.

### Displaying Profile Attribution
The UI automatically renders:
- **Pulling from**: Profile chips with avatars, friendly names, and direct links to Facebook.
- **Filtered by**: Hashtag badges and live status indicator.
- **Channel Filters**: Interactive channel tabs allowing visitors to filter posts by individual profiles or view all channels.

---

## 🌐 2. Trilingual System (English Main, Chinese, Malay)

- **Default Language**: English (`en`)
- **Supported Languages**:
  - English (`en`)
  - Chinese / 中文 (`zh`)
  - Malay / Bahasa Melayu (`ms`)
- **Language Switcher**: Click `EN | 中文 | BM` in the top navbar to toggle languages in real-time without reloading the page.
- **Master Keyfile**: All translations are located in **[`data/i18n.json`](data/i18n.json)**. You can freely edit any phrase in this master file.

---

## 🚀 3. Local Development (Live Reload)

```bash
# Recommended: npm live-reload script
npm run dev

# Or directly via npx
npx live-server
```

Opens automatically at: 👉 **`http://localhost:3000`**

---

## 📦 4. Production Build & Deployment (`dist/`)

The repository includes a dedicated build script that packages all assets cleanly into [`dist/`](dist/):

```bash
# Build the production package into dist/
npm run build

# Preview the dist build locally
npm run preview
```

### Live Editing `config.json` Directly in GitHub ⚡
You can edit site settings, hashtags, channels, or profile names directly in your browser on GitHub without touching terminal or running local builds:

1. In your GitHub repository, open **[`config.json`](config.json)**.
2. Click the **Pencil icon** (✏️ *Edit this file*).
3. Update any field (e.g. modify `"hashtags"`, change `"siteName"`, or add/remove channels in `"profiles"`).
4. Click **Commit changes** to `main`.
5. The automated GitHub Actions workflows take over immediately:
   - **[`update-feed.yml`](.github/workflows/update-feed.yml)** triggers on `config.json` changes: it runs `scripts/fetch-feed.js` to ingest & filter posts strictly by your new hashtags, rebuilds `dist/`, and commits.
   - **[`deploy.yml`](.github/workflows/deploy.yml)** deploys `dist/` directly to `klebang.boyz.space` in ~25 seconds.
   - The workflow also runs on a recurring schedule **every 2 hours** to pull fresh posts automatically.
6. The client app uses cache-busting headers (`config.json?v=<timestamp>` with `no-store`), ensuring visitors immediately receive the updated config on their next visit or by clicking the **Refresh** button!

---

## ⚙️ 5. GitHub Pages Setup (One-Time)

1. In your GitHub repository: Go to **Settings** > **Pages**.
2. Under **Build and deployment** > **Source**: Select **GitHub Actions** (recommended).
3. Custom domain [`CNAME`](CNAME) is automatically included in both the root and `dist/` as `klebang.boyz.space`.

