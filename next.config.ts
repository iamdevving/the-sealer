import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: '/.well-known/402index-verify.txt',
        destination: '/.well-known/402index-verify',
      },
    ];
  },
};

export default nextConfig;