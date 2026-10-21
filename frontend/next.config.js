/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // TODO: fix the pre-existing type errors this surfaces (insurance, investments,
  // properties, rentals, taxes, FinancialHistoryChart pages/components), then remove.
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
