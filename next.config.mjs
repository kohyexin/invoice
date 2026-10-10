/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server-only packages that must not be bundled by webpack.
    serverComponentsExternalPackages: ["@react-pdf/renderer", "exceljs", "pg", "unpdf", "imapflow", "mailparser", "fontkit"],
    // System-invoice PDFs are uploaded through a server action.
    serverActions: { bodySizeLimit: "20mb" },
    // PDFs are rendered from routes, server actions and crons alike, reading fonts and logos from disk.
    // pdfkit loads its Helvetica metrics through "#standard-fonts/*" subpath imports, which tracing misses.
    outputFileTracingIncludes: {
      "/**": ["./assets/fonts/**", "./public/logos/**", "./node_modules/pdfkit/js/standard-fonts/**"],
    },
  },
};

export default nextConfig;
