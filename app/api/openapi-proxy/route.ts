import { openapi } from '@/lib/openapi';

const proxy = openapi.createProxy();

export const { GET, POST, PUT, DELETE, PATCH, HEAD } = proxy;
