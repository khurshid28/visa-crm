FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# devDependencies ham kerak (tsx, prisma, tailwind, typescript) — dev rejimda ishlaymiz.
ENV NODE_ENV=development

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
