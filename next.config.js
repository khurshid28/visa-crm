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
    ],
  },
};

module.exports = nextConfig;
