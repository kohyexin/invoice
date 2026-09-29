"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

/* Plain values (not CSS vars) because recharts writes them into SVG attributes. */

export type ChartTheme = {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  brand: string;
  brandBright: string;
  glow: string;
};

const dark: ChartTheme = {
  grid: "#1C263C",
  axis: "#94A3BC",
  tooltipBg: "#0D1321",
  tooltipBorder: "#2B3650",
  tooltipText: "#EBEFF8",
  // Sapphire #1E40AF reads too dark on the dark canvas as a series color.
  brand: "rgb(84, 112, 214)",
  brandBright: "#22D3EE",
  glow: "drop-shadow(0 0 6px rgba(84, 112, 214, 0.85))",
};

const light: ChartTheme = {
  grid: "#E2E4F4",
  axis: "#7C809E",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "#E2E4F4",
  tooltipText: "#111226",
  brand: "rgb(30, 64, 175)",
  brandBright: "#22D3EE",
  glow: "drop-shadow(0 0 9px rgba(30, 64, 175, 0.55)) drop-shadow(0 0 3px rgba(34, 211, 238, 0.45))",
};

/** Chart colors for the active theme (dark before mount). */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return useMemo(() => (mounted && resolvedTheme === "light" ? light : dark), [mounted, resolvedTheme]);
}
