FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# devDependencies ham kerak (tsx, prisma, tailwind, typescript) — dev rejimda ishlaymiz.
ENV NODE_ENV=development

# Xvfb (virtual ekran) + xdotool (OS-klik) + x11-utils (xdpyinfo). Cloudflare
# Turnstile INTERAKTIV checkbox chiqsa, uni NON-headless Chrome + xdotool bilan
# bosamiz (docker-entrypoint.sh Xvfb ochadi, BOOKING_XVFB=true bo'lsa).
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb xdotool x11-utils \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# HAQIQIY Google Chrome (stable) — CDP rejimi (Turnstile/Cloudflare uchun ENG
# yaxshi) Playwright'ning ichki chromium'i emas, real chrome.exe/google-chrome
# talab qiladi. Linux'da /opt/google/chrome/chrome + symlink /usr/bin/google-chrome.
RUN npx playwright install chrome

COPY . .

# Prisma client (Linux binary) image ichida tayyorlanadi.
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "dev"]
