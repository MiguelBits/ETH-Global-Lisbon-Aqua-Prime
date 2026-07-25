/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Legacy route from the Aqua Prime era → Prime Desk terminal.
      { source: "/aqua-prime", destination: "/desk", permanent: false },
    ];
  },
};

module.exports = nextConfig;
