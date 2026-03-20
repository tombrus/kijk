#!/usr/bin/env bash
set -euo pipefail

# --- Validate required files ---
missing=()
[ ! -f secrets/master-key ] && missing+=("secrets/master-key")
[ ! -f secrets/page.html ]  && missing+=("secrets/page.html")
[ ! -f secrets/pat ]        && missing+=("secrets/pat")

if [ ${#missing[@]} -gt 0 ]; then
  echo "Error: missing required files:"
  for f in "${missing[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

PASSWORD=$(cat secrets/master-key)
PAT=$(cat secrets/pat)

# --- Auto-generate pat-key if missing ---
if [ ! -f secrets/pat-key ]; then
  openssl rand -base64 32 > secrets/pat-key
  echo "Generated secrets/pat-key"
fi
PAT_KEY=$(cat secrets/pat-key)

# --- Encrypt page.html → encrypted/payload.enc ---
mkdir -p encrypted
echo "$PASSWORD" | node src/encrypt.mjs
echo "Wrote encrypted/payload.enc"

# --- Determine repo from git remote ---
REMOTE_URL=$(git remote get-url origin)
# Handle SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
REPO=$(echo "$REMOTE_URL" | sed -E 's#(https://github\.com/|git@github\.com:)##; s#\.git$##')
echo "Repo: $REPO"

# --- Find or create Access Log issue ---
ISSUE=""
if [ -f secrets/monitor-issue ] && [ -s secrets/monitor-issue ]; then
  ISSUE=$(cat secrets/monitor-issue)
  echo "Using cached issue #$ISSUE"
else
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

  echo "$ISSUE" > secrets/monitor-issue
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

# --- Copy pat-key → encrypted/monitor.key ---
cp secrets/pat-key encrypted/monitor.key
echo "Wrote encrypted/monitor.key"

# --- Summary ---
echo ""
echo "=== prepare.sh complete ==="
echo "  encrypted/payload.enc   — content encrypted with master-key"
echo "  encrypted/monitor.enc   — monitor config encrypted with pat-key"
echo "  encrypted/monitor.key   — pat-key (for build injection + monitor decryption)"
echo ""
echo "Next: git add encrypted/ && git commit && git push"
