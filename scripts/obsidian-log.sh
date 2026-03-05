#!/usr/bin/env bash
# obsidian-log.sh — writes a rich Markdown entry to the Obsidian vault on every
# git commit. Called by .git/hooks/post-commit. Fails silently always.

# ── Vault path (Git Bash format) ──────────────────────────────────────────────
VAULT="/c/Users/sarvj/OneDrive/Documents/obsidian/Marwaha-Home/MyFinTech"

[[ ! -d "$VAULT" ]] && exit 0

# ── Commit metadata ───────────────────────────────────────────────────────────
HASH=$(git log -1 --format="%h")
MSG=$(git log -1 --format="%s")
AUTHOR=$(git log -1 --format="%an")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT_TS=$(git log -1 --format="%ci")
DATE_STR=$(echo "$COMMIT_TS" | cut -c1-10)
TIME_STR=$(echo "$COMMIT_TS" | cut -c12-16)
HUMAN_DATE=$(date -d "$DATE_STR" "+%B %-d, %Y" 2>/dev/null || echo "$DATE_STR")

# ── Paths ─────────────────────────────────────────────────────────────────────
DAY_DIR="$VAULT/$DATE_STR"
NOTE="$DAY_DIR/$DATE_STR.md"
mkdir -p "$DAY_DIR"

# ── Read changed files ─────────────────────────────────────────────────────────
mapfile -t FILE_LINES < <(git diff-tree --no-commit-id -r --name-status HEAD | awk '{print $1"\t"$2}')

# ── Module detection → tags + [[links]] ───────────────────────────────────────
TAGS_SET=""
LINKS_SET=""

add_tag() {
  local t="#${1}"
  if [[ "$TAGS_SET" != *"$t"* ]]; then TAGS_SET="${TAGS_SET} ${t}"; fi
}
add_link() {
  local l="[[${1}]]"
  if [[ "$LINKS_SET" != *"$l"* ]]; then LINKS_SET="${LINKS_SET} ${l}"; fi
}

emoji_for() {
  case "$1" in
    M) printf "✏️" ;;  A) printf "➕" ;;  D) printf "❌" ;;  R*) printf "🔀" ;;
    *) printf "·" ;;
  esac
}

describe_file() {
  local file="$1"
  local name
  name=$(basename "$file" | sed 's/\.[^.]*$//')
  case "$file" in
    frontend/src/app/*)
      local page; page=$(echo "$file" | sed 's|frontend/src/app/(app)/||' | cut -d'/' -f1)
      printf "%s page (UI)" "${page^}" ;;
    frontend/src/components/*)
      printf "%s UI component" "$(basename "$file" .tsx)" ;;
    frontend/src/lib/api.ts)
      printf "Frontend API client functions" ;;
    api/app/routers/*)
      printf "%s API endpoints" "${name^}" ;;
    api/app/models/*)
      printf "%s database model" "${name^}" ;;
    api/app/schemas/*)
      printf "%s request/response schemas" "${name^}" ;;
    api/app/services/*)
      printf "%s service layer" "${name^}" ;;
    api/app/worker.py)
      printf "Background task scheduler (Celery)" ;;
    api/alembic/versions/*)
      printf "Database migration script" ;;
    .claude/settings*)
      printf "Claude Code permission settings" ;;
    whatsapp-bot/*)
      printf "WhatsApp bot — %s" "$name" ;;
    scripts/*)
      printf "Dev script — %s" "$name" ;;
    *)
      printf "%s" "$name" ;;
  esac
}

# ── Process each file ─────────────────────────────────────────────────────────
TECH_FRONTEND="" TECH_BACKEND="" TECH_DATABASE="" TECH_WHATSAPP="" TECH_CONFIG=""

for entry in "${FILE_LINES[@]}"; do
  STATUS="${entry%%$'\t'*}"
  FILE="${entry#*$'\t'}"
  [[ -z "$STATUS" || -z "$FILE" ]] && continue

  EMOJI=$(emoji_for "$STATUS")
  DESC=$(describe_file "$FILE")
  LINE="  - ${EMOJI} ${DESC}"

  # Layer grouping
  if   [[ "$FILE" == api/alembic/* ]];   then TECH_DATABASE="${TECH_DATABASE}${LINE}"$'\n'
  elif [[ "$FILE" == frontend/* ]];       then TECH_FRONTEND="${TECH_FRONTEND}${LINE}"$'\n'
  elif [[ "$FILE" == api/* ]];            then TECH_BACKEND="${TECH_BACKEND}${LINE}"$'\n'
  elif [[ "$FILE" == whatsapp-bot/* ]];   then TECH_WHATSAPP="${TECH_WHATSAPP}${LINE}"$'\n'
  else                                         TECH_CONFIG="${TECH_CONFIG}${LINE}"$'\n'
  fi

  # Layer tags
  if   [[ "$FILE" == frontend/* ]];      then add_tag "frontend"
  elif [[ "$FILE" == api/alembic/* ]];   then add_tag "database"
  elif [[ "$FILE" == api/* ]];           then add_tag "backend"
  elif [[ "$FILE" == whatsapp-bot/* ]];  then add_tag "whatsapp"
  else                                        add_tag "config"
  fi

  # Module tags + Obsidian links
  case "$FILE" in
    *retirement*)   add_tag "retirement";    add_link "Retirement" ;;
    *insurance*)    add_tag "insurance";     add_link "Insurance" ;;
    *vehicle*)      add_tag "vehicles";      add_link "Insurance" ;;
    *investment*)   add_tag "investments";   add_link "Investment" ;;
    *propert*)      add_tag "real-estate";   add_link "Real Estate" ;;
    *loan*)         add_tag "real-estate";   add_link "Real Estate" ;;
    *budget*)       add_tag "budgets";       add_link "Budgets" ;;
    *transact*)     add_tag "transactions";  add_link "Transactions" ;;
    *account*)      add_tag "accounts";      add_link "Accounts" ;;
    *notif*)        add_tag "notifications" ;;
    *auth*)         add_tag "auth" ;;
    *user*)         add_tag "users" ;;
    *tax*)          add_tag "taxes" ;;
    *business*)     add_tag "business" ;;
    *snaptrade*)    add_tag "snaptrade";     add_link "Investment" ;;
    *worker*|*celery*) add_tag "background-jobs" ;;
    *settings*)     add_tag "settings" ;;
  esac
done

# Frontmatter tags — computed BEFORE trim so " #tag" → ", tag" via sed
FM_TAGS=$(echo "myfintech, dev-log${TAGS_SET}" | sed 's/ #/, /g')

# Trim leading space for inline display
TAGS_SET="${TAGS_SET# }"
LINKS_SET="${LINKS_SET# }"

# ── Build technical section ───────────────────────────────────────────────────
TECH_SECTION=""
count_lines() { echo "$1" | grep -c "^  - " 2>/dev/null || echo "0"; }

if [[ -n "$TECH_FRONTEND" ]]; then
  N=$(count_lines "$TECH_FRONTEND")
  S=$([ "$N" = "1" ] && echo "" || echo "s")
  TECH_SECTION+="- **Frontend** — ${N} file${S} changed"$'\n'"${TECH_FRONTEND}"
fi
if [[ -n "$TECH_BACKEND" ]]; then
  N=$(count_lines "$TECH_BACKEND")
  S=$([ "$N" = "1" ] && echo "" || echo "s")
  TECH_SECTION+="- **Backend** — ${N} file${S} changed"$'\n'"${TECH_BACKEND}"
fi
if [[ -n "$TECH_DATABASE" ]]; then
  N=$(count_lines "$TECH_DATABASE")
  S=$([ "$N" = "1" ] && echo "" || echo "s")
  TECH_SECTION+="- **Database** — ${N} migration${S}"$'\n'"${TECH_DATABASE}"
fi
if [[ -n "$TECH_WHATSAPP" ]]; then
  N=$(count_lines "$TECH_WHATSAPP")
  S=$([ "$N" = "1" ] && echo "" || echo "s")
  TECH_SECTION+="- **WhatsApp Bot** — ${N} file${S} changed"$'\n'"${TECH_WHATSAPP}"
fi
if [[ -n "$TECH_CONFIG" ]]; then
  N=$(count_lines "$TECH_CONFIG")
  S=$([ "$N" = "1" ] && echo "" || echo "s")
  TECH_SECTION+="- **Config / Scripts** — ${N} file${S} changed"$'\n'"${TECH_CONFIG}"
fi

# ── Non-technical summary ─────────────────────────────────────────────────────
MSG_SENTENCE="$(echo "$MSG" | sed 's/^./\u&/')"
[[ "$MSG_SENTENCE" != *. ]] && MSG_SENTENCE="${MSG_SENTENCE}."

if [[ -n "$LINKS_SET" ]]; then
  AFFECTED="Affects: ${LINKS_SET}"
else
  AFFECTED="General project maintenance and configuration."
fi

# ── Write to note ─────────────────────────────────────────────────────────────
IS_NEW=false
if [[ ! -f "$NOTE" ]]; then IS_NEW=true; fi

{
  if [[ "$IS_NEW" == true ]]; then
    printf -- "---\ndate: %s\ntags: [%s]\n---\n\n# MyFinTech Dev Log — %s\n\n" \
      "$DATE_STR" "$FM_TAGS" "$HUMAN_DATE"
  fi

  printf "\n---\n\n"
  printf "## %s · %s · %s\n" "$TIME_STR" "$HASH" "$MSG_SENTENCE"
  printf "%s  |  **Branch:** \`%s\`  |  **Author:** %s\n\n" "$TAGS_SET" "$BRANCH" "$AUTHOR"

  printf "### What Changed\n"
  printf -- "- %s\n" "$MSG_SENTENCE"
  printf -- "- %s\n\n" "$AFFECTED"

  printf "### Technical Changes\n"
  printf "%s\n" "$TECH_SECTION"

} >> "$NOTE" 2>/dev/null

exit 0
