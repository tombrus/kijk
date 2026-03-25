#!/usr/bin/env bash
set -euo pipefail

# --- Sync secrets from source repo ---
if [ -f secrets/sync.sh ]; then
  bash secrets/sync.sh
fi

INFO_FILE="secrets/info.json"

# --- Validate required files ---
missing=()
[ ! -f "$INFO_FILE" ]      && missing+=("$INFO_FILE")
[ ! -f secrets/page.html ]  && missing+=("secrets/page.html")

if [ ${#missing[@]} -gt 0 ]; then
  echo "Error: missing required files:"
  for f in "${missing[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

# --- Read values from info.json ---
PASSWORD=$(node -e "process.stdout.write(require('./$INFO_FILE')['master-key'])")
PAT=$(node -e "process.stdout.write(require('./$INFO_FILE')['pat'])")

# --- Validate required keys ---
if [ -z "$PASSWORD" ] || [ -z "$PAT" ]; then
  echo "Error: $INFO_FILE must contain 'master-key' and 'pat'"
  exit 1
fi

# --- Auto-generate pat-key if missing ---
PAT_KEY=$(node -e "const v=require('./$INFO_FILE')['pat-key']; if(v) process.stdout.write(v)")
if [ -z "$PAT_KEY" ]; then
  PAT_KEY=$(openssl rand -base64 32)
  node -e "
    const fs   = require('fs');
    const info = JSON.parse(fs.readFileSync('$INFO_FILE', 'utf8'));
    info['pat-key'] = '$PAT_KEY';
    fs.writeFileSync('$INFO_FILE', JSON.stringify(info, null, 2) + '\n');
  "
  echo "Generated pat-key in $INFO_FILE"
fi

# --- Read optional title ---
TITLE=$(node -e "const v=require('./$INFO_FILE')['title']; if(v) process.stdout.write(v)")

# --- Encrypt page.html → encrypted/payload.enc ---
mkdir -p encrypted
node src/encrypt.mjs
echo "Wrote encrypted/payload.enc"

# --- Write title ---
if [ -n "$TITLE" ]; then
  echo -n "$TITLE" > encrypted/title.txt
  echo "Wrote encrypted/title.txt"
fi

# --- Determine repo from git remote ---
REMOTE_URL=$(git remote get-url origin)
# Handle SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
REPO=$(echo "$REMOTE_URL" | sed -E 's#(https://github\.com/|git@github\.com:)##; s#\.git$##')
echo "Repo: $REPO"

# --- Find or create Access Log issue ---
ISSUE=$(node -e "const v=require('./$INFO_FILE')['monitor-issue']; if(v) process.stdout.write(String(v))")

if [ -z "$ISSUE" ]; then
  # Search for existing "Access Log" issue
  ISSUE=$(curl -s -H "Authorization: token $PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/issues?state=open&per_page=100" \
    | node -e "
      let d='';
      process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        const issues=JSON.parse(d);
        const found=issues.find(i=>i.title==='Access Log');
        if(found) process.stdout.write(String(found.number));
      });
    ")

  if [ -z "$ISSUE" ]; then
    # Create new issue
    ISSUE=$(curl -s -X POST \
      -H "Authorization: token $PAT" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/issues" \
      -d '{"title":"Access Log","body":"Automated access monitoring log"}' \
      | node -e "
        let d='';
        process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{
          const issue=JSON.parse(d);
          process.stdout.write(String(issue.number));
        });
      ")
    echo "Created issue #$ISSUE"
  else
    echo "Found existing issue #$ISSUE"
  fi

  # Save issue number back to info.json
  node -e "
    const fs   = require('fs');
    const info = JSON.parse(fs.readFileSync('$INFO_FILE', 'utf8'));
    info['monitor-issue'] = $ISSUE;
    fs.writeFileSync('$INFO_FILE', JSON.stringify(info, null, 2) + '\n');
  "
else
  echo "Using cached issue #$ISSUE"
fi

# --- Build API URL and encrypt monitor config ---
API_URL="https://api.github.com/repos/$REPO/issues/$ISSUE/comments"
CONFIG="{\"url\":\"$API_URL\",\"token\":\"$PAT\"}"

node -e "
  const { randomBytes, createCipheriv } = require('crypto');
  const key  = Buffer.from(process.argv[1], 'base64');
  const iv   = randomBytes(12);
  const cipher    = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(process.argv[2], 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  const combined  = Buffer.concat([iv, encrypted, authTag]);
  process.stdout.write(combined.toString('base64'));
" "$PAT_KEY" "$CONFIG" > encrypted/monitor.enc

echo "Wrote encrypted/monitor.enc"

# --- Write pat-key → encrypted/monitor.key ---
echo -n "$PAT_KEY" > encrypted/monitor.key
echo "Wrote encrypted/monitor.key"

# --- Fetch monitor log ---
npm run monitor

# --- Summary ---
echo ""
echo "=== prepare.sh complete ==="
echo "  encrypted/payload.enc   — content encrypted with master-key"
echo "  encrypted/monitor.enc   — monitor config encrypted with pat-key"
echo "  encrypted/monitor.key   — pat-key (for build injection + monitor decryption)"
echo ""
echo "Next: git add encrypted/ && git commit && git push"
