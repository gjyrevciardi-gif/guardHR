#!/bin/sh
# Smoke checks for a deployed host (docs/staging.md): ./deploy/check-staging.sh https://hr.example.com
# Needs curl and openssl; the TURN port checks also need nc and are skipped without it. It cannot prove that media flows
# through the relay: finish with the Trickle ICE test described in docs/staging.md.
set -u
URL=${1:?usage: check-staging.sh https://hr.example.com}
HOST=${URL#https://}; HOST=${HOST%%/*}
failed=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; failed=1; }
check() { desc=$1; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi; }

check "http://$HOST redirects to https" sh -c "curl -sI --max-time 10 http://$HOST/ | grep -qi '^location: https://'"
check "certificate is trusted and valid for 14+ days" sh -c "echo | openssl s_client -connect $HOST:443 -servername $HOST -verify_return_error 2>/dev/null | openssl x509 -noout -checkend 1209600"
check "security headers are sent" sh -c "curl -sI --max-time 10 $URL/ | grep -qi '^strict-transport-security'"

health=$(curl -fsS --max-time 10 "$URL/api/health" 2>/dev/null) || health=
if [ -z "$health" ]; then bad "GET /api/health"; else
  ok "GET /api/health"
  case $health in *'"vision":true'*) ok "phone / extra-person detection is installed (INSTALL_CV=true)";; *) bad "vision is false: the image was built with INSTALL_CV=false";; esac
  echo "      frames: $(echo "$health" | sed 's/.*"frames"://')"
fi

check "/privacy names the operator (set OPERATOR_NAME and OPERATOR_CONTACT)" sh -c "curl -fsS --max-time 10 $URL/privacy | grep -q 'id=\"operator\"'"

rtc=$(curl -fsS --max-time 10 "$URL/api/rtc-config" 2>/dev/null) || rtc=
case $rtc in
  *'"username"'*) ok "/api/rtc-config offers a TURN relay with a temporary credential";;
  *) bad "/api/rtc-config has no TURN relay (set TURN_URLS and TURN_SECRET)";;
esac

if command -v nc >/dev/null 2>&1; then
  check "TURN answers on tcp $HOST:3478" nc -z -w 5 "$HOST" 3478
  check "TURN answers on tcp $HOST:5349 (turns:)" nc -z -w 5 "$HOST" 5349
  check "turns: certificate is trusted" sh -c "echo | openssl s_client -connect $HOST:5349 -servername $HOST -verify_return_error 2>/dev/null | grep -qE 'Verification: OK|Verify return code: 0'"
else
  echo "skip  TURN port checks (nc not installed)"
fi

exit $failed
