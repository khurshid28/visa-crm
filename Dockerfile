FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# devDependencies ham kerak (tsx, prisma, tailwind, typescript) — dev rejimda ishlaymiz.
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Prisma client (Linux binary) image ichida tayyorlanadi.
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "dev"]
