/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server-only packages that must not be bundled by webpack.
    serverComponentsExternalPackages: ["@react-pdf/renderer", "exceljs", "pg", "unpdf", "imapflow", "mailparser"],
    // System-invoice PDFs are uploaded through a server action.
    serverActions: { bodySizeLimit: "20mb" },
    // PDF routes read fonts and logos from disk at runtime.
    outputFileTracingIncludes: {
      "/api/invoices/**": ["./assets/fonts/**", "./public/logos/**"],
    },
  },
};

export default nextConfig;
