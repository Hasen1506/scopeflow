import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: { cpus: 2 },
};

export default nextConfig;
