#!/usr/bin/env sh
# ====================================================================
#  DOCKER ENTRYPOINT — Xvfb virtual ekran (Turnstile OS-klik uchun)
# ====================================================================
#  Linux konteynerda ekran yo'q. Cloudflare Turnstile INTERAKTIV checkbox
#  ("Verify you are human") chiqsa, uni bosish uchun haqiqiy oyna + kursor
#  (xdotool) kerak. Buning uchun Xvfb (X Virtual Framebuffer) virtual ekran
#  ochamiz va Chrome'ni NON-headless shu ekranda ishlatamiz.
#
#  Yoqish: BOOKING_XVFB=true (docker-compose'da). Aks holda oddiy (headless)
#  ishlaymiz — Xvfb ishga tushmaydi (yengilroq).
#
#  Ishlatish (docker-compose):
#    entrypoint: ["sh", "/app/docker-entrypoint.sh"]
#    command: npm run worker:slot
# ====================================================================
set -e

if [ "${BOOKING_XVFB}" = "true" ]; then
  # DISPLAY berilmagan bo'lsa :99 ishlatamiz.
  if [ -z "${DISPLAY}" ]; then
    DISPLAY=":99"
  fi
  export DISPLAY
  SCREEN="${XVFB_SCREEN:-1280x1024x24}"

  echo "[entrypoint] Xvfb ishga tushyapti: DISPLAY=${DISPLAY} screen=${SCREEN}"
  # -ac: kirish nazoratini o'chiradi (mahalliy klientlar uchun qulay).
  Xvfb "${DISPLAY}" -screen 0 "${SCREEN}" -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
  XVFB_PID=$!

  # Xvfb tayyor bo'lishini kutamiz (xdpyinfo ulanguncha, ~6s).
  i=0
  while [ "$i" -lt 30 ]; do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
      echo "[entrypoint] Xvfb tayyor."
      break
    fi
    i=$((i + 1))
    sleep 0.2
  done

  # Konteyner to'xtaganda Xvfb'ni ham tozalaymiz.
  trap 'kill "${XVFB_PID}" 2>/dev/null || true' TERM INT EXIT
fi

# Asl buyruqni (npm run worker:slot ...) shu muhitda ishga tushiramiz.
exec "$@"
