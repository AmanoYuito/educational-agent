const basePath = process.env.BASE_PATH || ''
const publicPath = process.env.PUBLIC_PATH || basePath

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  assetPrefix: publicPath,
  basePath,
  trailingSlash: true,
  publicRuntimeConfig: {
    root: publicPath,
    basePath,
  },
  optimizeFonts: false,
  async headers() {
    return [
      {
        source: '/live2d/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
