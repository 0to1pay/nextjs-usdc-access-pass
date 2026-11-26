export default {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  experimental: { inlineCss: true },
  serverExternalPackages: ['@0to1pay/server-sdk', '@0to1pay/fulfillment-sdk', 'pg'],
};
