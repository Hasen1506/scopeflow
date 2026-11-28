import type {MetadataRoute} from 'next';
import {configuredOrigin} from '@/lib/origin';
import {PUBLIC_PAGES, SITE_ORIGIN_FALLBACK} from '@/config/site';
// Gap audit M10: the public pages only.
const HIGH_INTENT = new Set(['/check', '/msme-interest', '/plans']);

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = configuredOrigin() ?? SITE_ORIGIN_FALLBACK;
  return PUBLIC_PAGES.map(path => ({
    url: origin + path,
    changeFrequency: path === '/' || HIGH_INTENT.has(path) ? ('weekly' as const) : ('monthly' as const),
    priority: path === '/' ? 1 : HIGH_INTENT.has(path) ? 0.9 : 0.6,
  }));
}
