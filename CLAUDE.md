# Kijk — Encrypted GitHub Pages Wrapper

Host private HTML on public GitHub Pages. The repo stores only an encrypted payload and a decryption wrapper.

## Project Structure

- `content/page.html` — secret HTML (gitignored)
- `encrypted/payload.enc` — base64-encoded encrypted payload (committed)
- `src/encrypt.mjs` — encrypts content → payload using Node.js crypto
- `src/build.mjs` — embeds payload into wrapper → `dist/index.html`
- `src/wrapper.html` — password form + Web Crypto decryption logic
- `dist/` — build output (gitignored)
- `.github/workflows/deploy.yml` — builds and deploys to gh-pages

## Encryption

- AES-256-GCM, PBKDF2 (SHA-256, 600k iterations), 16-byte salt, 12-byte IV
- Stored format: base64 of `salt(16) || iv(12) || ciphertext || authTag(16)`
- Node.js `crypto` for encryption, Web Crypto API for browser decryption

## Scripts

- `npm run encrypt` — encrypt `content/page.html` (prompts for password)
- `npm run build` — build `dist/index.html` from wrapper + payload

## Workflow

1. Place HTML in `content/page.html`
2. `npm run encrypt` → enter password
3. `npm run build` → preview locally
4. Commit `encrypted/payload.enc`, push to `main`
5. GitHub Action deploys to gh-pages
