import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "!./lib/generated/**",
  ],
  theme: {
    extend: {
      colors: {
        // Gatehub design system — voltage indigo by default. Driven by CSS vars so
        // the whole accent can flip to amber under .env-sandbox (test environment).
        brand: {
          DEFAULT: "rgb(var(--brand-default) / <alpha-value>)",
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
        },
        // Semantic tokens are CSS variables so they flip between light/dark
        canvas: "rgb(var(--canvas) / <alpha-value>)", // App canvas background
        surface: "rgb(var(--surface) / <alpha-value>)", // Cards, panels, sidebars
        elevated: "rgb(var(--elevated) / <alpha-value>)", // Hover / inset surfaces
        // Direction-aware tint: white in dark mode, ink in light mode
        overlay: "rgb(var(--overlay) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)", // Text primary
          muted: "rgb(var(--ink-muted) / <alpha-value>)", // Text secondary
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
        },
        line: "rgb(var(--line) / <alpha-value>)", // 1px borders
        success: {
          DEFAULT: "#10B981",
          soft: "#D1FAE5",
        },
        danger: {
          DEFAULT: "#EF4444",
          soft: "#FEE2E2",
        },
        warning: {
          DEFAULT: "#F59E0B",
          soft: "#FEF3C7",
        },
        // Crypto-exchange directional + neon accents (dark theme)
        up: "#0ECB81", // gains green
        down: "#F6465D", // losses red
        neon: {
          green: "#0ECB81",
          cyan: "#22D3EE",
          violet: "#8B5CF6",
          blue: "#3B82F6",
        },
      },
      borderRadius: {
        card: "8px",
        control: "6px",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        brand: ["var(--font-brand)", "Baloo 2", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.04)",
        float: "0 16px 40px -12px rgba(15, 23, 42, 0.2), 0 4px 12px -4px rgba(15, 23, 42, 0.08)",
        glow: "0 0 0 4px rgb(var(--brand-500) / 0.12)",
        brand: "0 6px 16px -4px rgb(var(--brand-600) / 0.35)",
        // Neon glows for the crypto-exchange dark theme
        "glow-brand": "0 0 28px -6px rgb(var(--brand-500) / 0.6)",
        "glow-cyan": "0 0 28px -6px rgba(34, 211, 238, 0.55)",
        "glow-green": "0 0 28px -6px rgba(14, 203, 129, 0.55)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "slide-in-left": {
          "0%": { opacity: "0", transform: "translateX(-100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        // Toasts: quick fade-and-drift exit after the countdown expires
        "toast-out": {
          "0%": { opacity: "1", transform: "translateX(0) scale(1)" },
          "100%": { opacity: "0", transform: "translateX(24px) scale(0.97)" },
        },
        // DataTable: rows settle in when the view (filter/sort/page) changes
        "row-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // DataTable: brand-tinted pulse highlighting freshly added rows
        "row-flash": {
          "0%": { backgroundColor: "rgb(var(--brand-500) / 0.14)" },
          "60%": { backgroundColor: "rgb(var(--brand-500) / 0.08)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "pulse-glow": "pulse-glow 3s ease-in-out infinite",
        "slide-in-left": "slide-in-left 0.22s ease-out both",
        "slide-in-right": "slide-in-right 0.22s ease-out both",
        "toast-out": "toast-out 0.18s ease-in both",
        // "backwards" (not "both"): a forwards-filled transform would leave a
        // permanent stacking context on each <tr>, breaking z-index layering
        // of row-action dropdowns. Background likewise must return to
        // class-driven styles (hover/selected tints) once the pulse ends.
        "row-in": "row-in 0.3s ease-out backwards",
        "row-flash": "row-flash 1.6s ease-out",
        "row-new": "row-in 0.3s ease-out backwards, row-flash 1.6s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
