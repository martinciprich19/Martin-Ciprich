import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Avoid stale on-disk compiler references in the synced Windows workspace.
    turbopackFileSystemCacheForDev: false,
  },
}

export default nextConfig
