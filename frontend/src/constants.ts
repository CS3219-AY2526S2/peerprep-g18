// This file contains constants used throughout the frontend application.
// In production (AWS), these are injected by the CI/CD pipeline.
// In development, they default to localhost.

export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost/api';
export const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://localhost';

