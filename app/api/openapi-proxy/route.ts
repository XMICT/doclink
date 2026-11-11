import { openapi, apiUrl } from '@/lib/openapi';

const proxy = openapi.createProxy({
  allowedOrigins: apiUrl ? [new URL(apiUrl).origin] : undefined,
});

export const { GET, POST, PUT, DELETE, PATCH, HEAD } = proxy;
