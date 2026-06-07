/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "xlsx",
      "pdf-lib",
      "@prisma/client",
      "playwright",
      "playwright-core",
      "playwright-extra",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "clone-deep",
      "merge-deep",
    ],
  },
};

module.exports = nextConfig;
