/* Chart colors for the dark Midnight workspace. Plain values (not CSS vars)
   because recharts writes them into SVG attributes. */

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

const theme: ChartTheme = {
  grid: "#1C263C",
  axis: "#94A3BC",
  tooltipBg: "#0D1321",
  tooltipBorder: "#2B3650",
  tooltipText: "#EBEFF8",
  // Sapphire #1E40AF reads too dark on the canvas as a series color, so the
  // chart line uses the lighter end of the Midnight scale.
  brand: "rgb(84, 112, 214)",
  brandBright: "#22D3EE",
  glow: "drop-shadow(0 0 6px rgba(84, 112, 214, 0.85))",
};

export function useChartTheme(): ChartTheme {
  return theme;
}
