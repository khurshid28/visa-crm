import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#bcd3ff",
          300: "#8eb5ff",
          400: "#598cff",
          500: "#3563ff",
          600: "#1e3ff5",
          700: "#162ee1",
          800: "#1827b6",
          900: "#1a288f",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 2px 8px -2px rgb(0 0 0 / 0.08), 0 4px 16px -4px rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
