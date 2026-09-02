# Kijk — Encrypted GitHub Pages Wrapper

Host private HTML on public GitHub Pages. The repo stores only an encrypted payload and a decryption wrapper.

## Project Structure

- `secrets/page.html` — secret HTML (gitignored)
- `secrets/sync.sh` — copies info.json and page.html from source repo (gitignored)
- `secrets/info.json` — master-key, pat, pat-key, monitor-issue, title (gitignored)
  - WARNING: this file is a synced copy. `prepare.sh` runs `sync.sh` first, which overwrites it from the source repo. Never edit `secrets/info.json` directly — edits are silently lost on the next prepare/sync. Always edit info.json in the source repo (path in `secrets/sync.sh`).
- `encrypted/payload.enc` — base64-encoded encrypted payload (committed)
- `encrypted/monitor.enc` — encrypted monitor config (committed)
- `encrypted/monitor.key` — pat-key copy for build + monitor (committed)
- `encrypted/title.txt` — page title for the password dialog (committed)
- `src/encrypt.mjs` — encrypts content → payload using Node.js crypto
- `src/build.mjs` — embeds payload + monitor data into wrapper → `dist/index.html` + `dist/version.txt`
- `src/wrapper.html` — password form + Web Crypto decryption logic + session persistence + logout + cache-busting
- `src/monitor.mjs` — CLI script to fetch and decrypt access log entries
- `prepare.sh` — local script that encrypts everything and prepares committed artifacts
- `dist/` — build output (gitignored)
- `.github/workflows/deploy.yml` — builds and deploys to gh-pages
- `README.md` — public-facing documentation for external users

## Encryption

- AES-256-GCM, PBKDF2 (SHA-256, 600k iterations), 16-byte salt, 12-byte IV
- Salt is reused from existing payload on re-encryption to keep the content-derived key stable (preserves monitor secure entry decryptability)
- Stored format: base64 of `salt(16) || iv(12) || ciphertext || authTag(16)`
- Node.js `crypto` for encryption, Web Crypto API for browser decryption
- Derived AES key bits (not the password) stored in `sessionStorage` (key `kijk-key`) for tab-scoped session persistence
- Logout button clears storage and reloads

## Cache Busting

- `build.mjs` computes a SHA-256 hash (first 8 hex chars) of the HTML before injecting the hash
- Hash is embedded in the wrapper as `BUILD_HASH` constant and written to `dist/version.txt`
- On page load, the wrapper fetches `version.txt` with `cache: "no-store"` (always hits server)
- If the server hash differs from the embedded hash, the wrapper refetches `location.pathname` with `cache: "reload"` to bypass the HTTP cache (and the CDN cache via the resulting `Cache-Control: no-cache` request header), then replaces the current document via `document.open`/`write`/`close`
- This avoids relying on query-string cache keying (which CDNs may ignore) and avoids needing a manual hard refresh
- `build.mjs` also injects `{{BUILD_DATE}}` (YYYY-MM-DD). Date + hash are displayed as small print in the lower-left corner on both the password screen and the decrypted page

## Monitoring (Access Log via GitHub Issues)

Optional feature: logs access events (unlock, session restore, failed attempts) as comments on a dedicated GitHub Issue.

### How It Works

- `prepare.sh` encrypts the API URL + PAT with a random AES-256-GCM key (pat-key)
- The encrypted config is stored in `encrypted/monitor.enc`, the key in `encrypted/monitor.key`
- `build.mjs` reads these files and injects them into the wrapper as `{{MONITOR_KEY}}` and `{{MONITOR_DATA}}`
- No GitHub secrets needed — the deploy workflow just runs `npm run build`
- Two encryption tiers for log entries:
  - **Secure**: encrypted with the content-derived AES key (only password holders can read)
  - **Obfuscated**: encrypted with the pat-key (prevents casual reading on public issue)
- Successful access → `[secure:...]`, failed attempts → `[obfuscated:...]`

### User Setup (one-time)

1. Create a fine-grained PAT (github.com → Settings → Developer settings)
   - Scope: this repo only, permission: Issues (Read & Write)
2. Create `secrets/info.json`:
   ```json
   {
     "master-key": "mypassword",
     "pat": "ghp_xxx",
     "title": "My Page"
   }
   ```
3. Run `./prepare.sh` (auto-generates pat-key, finds/creates issue, saves them back to info.json, encrypts everything)
4. Commit `encrypted/` and push

### Renewing the PAT (when it expires — API returns 401)

1. github.com → Settings → Developer settings → Fine-grained tokens → regenerate (or create new: this repo only, Issues Read & Write)
2. Put the token in the `"pat"` field of info.json **in the source repo** (not `secrets/info.json` — sync overwrites that, see the warning under Project Structure) and save the file to disk
3. Run `./prepare.sh` — it re-encrypts `monitor.enc` and verifies by running `npm run monitor`
4. `git add encrypted/ && git commit && git push`

### Reading the Log

```
npm run monitor
```

(Reads config from `encrypted/monitor.enc` + `encrypted/monitor.key`, reads password from `secrets/info.json` or prompts if missing. Outputs aligned columns: tier, event, date, IP, user agent. Also writes a markdown report to `secrets/monitor.md`.)

### Files

- `src/monitor.mjs` — CLI script to fetch and decrypt all log entries
- `encrypted/monitor.key` — random AES key for obfuscated entries (committed)
- `encrypted/monitor.enc` — encrypted API URL + PAT (committed)

## Scripts

- `npm run build` — build `dist/index.html` from wrapper + payload
- `npm run monitor` — read and decrypt the access log (prompts for content password)
- `npm run prepare-secrets` — run `prepare.sh` to encrypt all secrets

## Workflow

1. One-time setup — create `secrets/info.json` with `master-key` and `pat`
2. Run `./prepare.sh` (encrypts page, sets up monitoring)
3. `npm run build` → preview locally
4. `git add encrypted/ && git commit && git push`
5. GitHub Action runs `npm run build` → deploys to gh-pages
