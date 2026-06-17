import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '..'),
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    config.resolve.symlinks = true;
    return config;
  },
};

export default withMDX(config);
