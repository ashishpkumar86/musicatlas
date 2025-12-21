/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow slow upstream FastAPI calls during dev without Next dev proxy timing out.
    proxyTimeout: 300000 // 5 minutes
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/:path*'
      }
    ];
  }
};

export default nextConfig;
