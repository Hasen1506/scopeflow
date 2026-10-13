import type {MetadataRoute} from 'next';
import {configuredOrigin} from '@/lib/origin';
import {ROBOTS_DISALLOW, SITE_ORIGIN_FALLBACK} from '@/config/site';
// Gap audit M10: crawl the public pages; skip APIs, bearer-token pages and signed-in shells.
export default function robots(): MetadataRoute.Robots {
  const origin = configuredOrigin() ?? SITE_ORIGIN_FALLBACK;
  return {rules: [{userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW]}], sitemap: origin + '/sitemap.xml', host: origin};
}
