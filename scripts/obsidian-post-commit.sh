#!/bin/bash
# =============================================================================
# Obsidian Post-Commit Hook — Etapa 1 (sync, sem IA)
# Appenda commit no daily changelog do Obsidian vault
# =============================================================================

VAULT_ROOT="Obsidian/Segundo Cerebro/Claude Code — Torque CRM"
CHANGELOG_DIR="${VAULT_ROOT}/07 — Changelog"
FEATURE_MAP="scripts/obsidian-feature-map.json"

# Get commit data
COMMIT_HASH=$(git log -1 --format='%h')
COMMIT_MSG=$(git log -1 --format='%s')
COMMIT_TIME=$(git log -1 --format='%H:%M')
COMMIT_DATE=$(git log -1 --format='%Y-%m-%d')
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | head -20)

# Daily note path
DAILY_NOTE="${CHANGELOG_DIR}/${COMMIT_DATE}.md"

# Create daily note if it doesn't exist
if [ ! -f "$DAILY_NOTE" ]; then
  mkdir -p "$CHANGELOG_DIR"
  cat > "$DAILY_NOTE" << HEREDOC
---
tags:
  - claude-code
  - changelog
  - daily
created: ${COMMIT_DATE}
---

# Changelog — ${COMMIT_DATE}

## Resumo do dia

## Commits
HEREDOC
fi

# Format changed files as bullet list
FILES_LIST=""
for f in $CHANGED_FILES; do
  FILES_LIST="${FILES_LIST}\n- \`${f}\`"
done

# Detect features affected (simple path matching)
FEATURES=""
if [ -f "$FEATURE_MAP" ]; then
  for f in $CHANGED_FILES; do
    # Use grep to find matching paths in the feature map
    MATCH=$(grep -o "\"[^\"]*\"" "$FEATURE_MAP" | while read -r key; do
      clean_key=$(echo "$key" | tr -d '"')
      if echo "$f" | grep -q "$clean_key" 2>/dev/null; then
        # Get the value (feature name) for this key
        grep "\"${clean_key}\"" "$FEATURE_MAP" | grep -o ': *"[^"]*"' | tr -d '": ' | head -1
      fi
    done | sort -u | head -5)
    if [ -n "$MATCH" ]; then
      FEATURES="${FEATURES} ${MATCH}"
    fi
  done
fi

# Deduplicate features
if [ -n "$FEATURES" ]; then
  FEATURES_FORMATTED=$(echo "$FEATURES" | tr ' ' '\n' | sort -u | sed '/^$/d' | sed 's/^/[[/' | sed 's/$/]]/' | tr '\n' ', ' | sed 's/,$//')
else
  FEATURES_FORMATTED="nenhuma"
fi

# Append to daily note
printf "\n### %s — %s\n- **Arquivos**: %b\n- **Features afetadas**: %s\n" \
  "$COMMIT_TIME" "$COMMIT_MSG" "$FILES_LIST" "$FEATURES_FORMATTED" >> "$DAILY_NOTE"

# Detect if commit is significant (feat/fix/refactor/spec prefix)
COMMIT_PREFIX=$(echo "$COMMIT_MSG" | grep -oE '^(feat|fix|refactor|spec)' | head -1)

if [ -n "$COMMIT_PREFIX" ]; then
  # Write marker for Claude Code to pick up (Etapa 2)
  mkdir -p .claude
  echo "${COMMIT_HASH}|${COMMIT_MSG}|${COMMIT_DATE}" > .claude/last-significant-commit
fi

exit 0
