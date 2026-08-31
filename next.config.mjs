/** @type {import('next').NextConfig} */
const nextConfig = {
  // WebMCP tool registration talks to the browser's model context API at
  // runtime; no server-rendered access needed.
  reactStrictMode: true,
};

export default nextConfig;
