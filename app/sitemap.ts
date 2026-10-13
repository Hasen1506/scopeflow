import type {MetadataRoute} from 'next';
import {configuredOrigin} from '@/lib/origin';
import {PUBLIC_PAGES, SITE_ORIGIN_FALLBACK} from '@/config/site';
// Gap audit M10: the public pages only.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = configuredOrigin() ?? SITE_ORIGIN_FALLBACK;
  return PUBLIC_PAGES.map(path => ({url: origin + path, changeFrequency: 'monthly' as const, priority: path === '/' ? 1 : 0.5}));
}
