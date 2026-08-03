import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f2540",
        navy: "#0f2540",
        teal: "#0d7bd7",
        mist: "#eaf7fb",
      },
      boxShadow: { soft: "0 24px 80px rgba(13, 123, 215, 0.14)" },
    },
  },
  plugins: [],
} satisfies Config;
