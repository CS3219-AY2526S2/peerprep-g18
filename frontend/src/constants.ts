// This file contains constants used throughout the frontend application.
// In production (AWS), these are proxied by CloudFront to the respective services.
// In development, they default to localhost.

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '/api';
export const ALB_URL = import.meta.env.VITE_ALB_URL || '';

