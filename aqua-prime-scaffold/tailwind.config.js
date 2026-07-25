/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        aqua: {
          50: "#ecfeff",
          500: "#06b6d4",
          700: "#0e7490",
          900: "#164e63",
        },
      },
    },
  },
  plugins: [],
};
