/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Analysis reads the local filesystem; keep server code out of any client bundle.
  serverExternalPackages: [],
};
export default nextConfig;
