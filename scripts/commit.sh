#!/bin/sh
# 사용법: ./scripts-commit.sh <항목ID> "<커밋 메시지>"  — PROGRESS.md 체크 후 커밋
set -e
sed -i "s/^- \[ \] $1 /- [x] $1 /" PROGRESS.md
git add -A
git commit -q -m "$1: $2

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WQaDu5jDy9Rs2sb3awDbcg"
git log --oneline | head -1
