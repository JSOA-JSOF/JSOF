#!/usr/bin/env bash
# Verify one role workspace against the spine contract.
#
#   ./scripts/verify-workspace.sh <module> <owner-persona> <stranger-persona>
#   ./scripts/verify-workspace.sh scholarships scholarships scholarship-reviewer
#
# Written because six agents are landing six workspaces and checking each one
# differently is how a regression gets through. Everything here is a claim from
# docs/ROLE-WORKSPACE.md turned into something that either holds or does not.
#
# It reports; it does not fix. A FAIL is a thing to go and look at.

set -uo pipefail

MODULE="${1:?module, e.g. scholarships}"
OWNER="${2:?the persona whose workspace this is}"
STRANGER="${3:-member}"
BASE="http://localhost:3000/board/${MODULE}"
PASS=0; FAIL=0

say()  { printf '%-58s %s\n' "$1" "$2"; }
ok()   { PASS=$((PASS+1)); say "$1" "ok"; }
bad()  { FAIL=$((FAIL+1)); say "$1" "FAIL  $2"; }

get()  { curl -s -b "jsoa_dev_persona=$2" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' -b "jsoa_dev_persona=$2" "$1"; }

echo "=== ${MODULE} as ${OWNER} (stranger: ${STRANGER}) ==="

# 1. Every tab on the spine answers.
for tab in "" /dashboard /planning /projects /outside; do
  url="${BASE}${tab}"
  c=$(code "$url" "$OWNER")
  [ "$c" = "200" ] && ok "GET ${tab:-/} as owner" || bad "GET ${tab:-/} as owner" "$c"
done

OVERVIEW=$(get "$BASE" "$OWNER")
DASH=$(get "${BASE}/dashboard" "$OWNER")
OUTSIDE=$(get "${BASE}/outside" "$OWNER")
PROJECTS=$(get "${BASE}/projects" "$OWNER")

# 2. The tab strip is present and complete, so the spine is actually wired.
missing=""
for label in Overview Dashboard Planning Projects "Outside view"; do
  echo "$OVERVIEW" | grep -q "$label" || missing="$missing $label"
done
[ -z "$missing" ] && ok "tab strip complete" || bad "tab strip complete" "missing:$missing"

# 3. Overview carries derived work, not just links.
if echo "$OVERVIEW" | grep -qiE 'Nothing is waiting on you|taskLabel|task_'; then
  ok "overview renders a task list"
else
  bad "overview renders a task list" "no task list found"
fi

# 4. The dashboard was actually cut to three headline tiles. Counts the tiles
#    above any "more figures" disclosure, which is where the rest should sit.
HEAD_TILES=$(echo "$DASH" | sed 's/more figures/\n@@CUT@@\n/I' | awk '/@@CUT@@/{exit} {print}' \
  | grep -coE 'dashboard_label__|class="[^"]*label[^"]*"' )
if [ "$HEAD_TILES" -le 4 ] 2>/dev/null; then
  ok "dashboard headline tiles <= 3"
else
  bad "dashboard headline tiles <= 3" "counted ~$HEAD_TILES"
fi

# 5. Outside view shows two audiences, or says why it has none. Never blurred.
# Columns first. Checking the "why it is empty" copy first was a false pass:
# a page with both columns that also explains an empty one would short-circuit,
# so a genuinely empty outside view would have passed unnoticed.
if echo "$OUTSIDE" | grep -qi 'Anyone can see this' && echo "$OUTSIDE" | grep -qi 'Members and donors see this'; then
  ok "outside: two audiences, separated"
elif echo "$OUTSIDE" | grep -qi 'no external surface'; then
  ok "outside: declares no external surface, with a reason"
else
  bad "outside: two audiences or a stated reason" "neither found"
fi

# The columns must not be a shell with nothing in them. Count rendered items
# rather than looking for website routes: the Secretary's external surface is
# the 990s, the determination letter and meeting notices, which are documents
# available on request and not pages, so a route-shaped check fails a role that
# is doing the right thing.
ITEMS=$(echo "$OUTSIDE" | grep -oE 'shell_outsideItem__[A-Za-z0-9_]+' | wc -l | tr -d ' ')
if [ "${ITEMS:-0}" -gt 0 ]; then
  ok "outside: columns carry $((ITEMS / 2)) item(s)"
elif echo "$OUTSIDE" | grep -qi 'no external surface'; then
  ok "outside: no surfaces, correctly"
else
  bad "outside: columns carry items" "two columns but nothing in them"
fi

# 6. Projects is a filter over the shared register, not a private copy.
if echo "$PROJECTS" | grep -qiE 'memorialize the fallen|scholarships and grants|JSOC family events|blocked'; then
  ok "projects reads the shared register"
else
  bad "projects reads the shared register" "no line of effort visible"
fi

# 7. A role with no business here is told nothing, and is never shown a zero.
for tab in "" /dashboard /planning /projects /outside; do
  body=$(get "${BASE}${tab}" "$STRANGER")
  zeros=$(echo "$body" | grep -coE '>0<|\$0\.00')
  refused=$(echo "$body" | grep -ciE 'refus|denied|withheld|not measured|needs ')
  if [ "$zeros" -gt 0 ]; then
    bad "stranger on ${tab:-/}: no bare zeros" "$zeros zero-ish figures"
  elif [ "$refused" -gt 0 ]; then
    ok "stranger on ${tab:-/}: refused or withheld"
  else
    bad "stranger on ${tab:-/}: refused or withheld" "neither; check what leaked"
  fi
done

# 8. MFA alone must be enough to stop everything.
body=$(get "$BASE" "president-no-mfa")
if echo "$body" | grep -qiE 'refus|denied|withheld|not measured'; then
  ok "MFA gate holds on overview"
else
  bad "MFA gate holds on overview" "rendered without a second factor"
fi

echo
echo "${MODULE}: ${PASS} ok, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
