import { createAvatar } from '@dicebear/core';
import * as avataaars from '@dicebear/avataaars';

export function avatarUrl(seed: number): string {
  const svg = createAvatar(avataaars, { seed: String(seed) }).toString();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
