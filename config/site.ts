// The one place the public contact details live (gap audit H6/H7). Footer, /contact, /support, the
// legal pages and /.well-known/security.txt all read SUPPORT_EMAIL from here.
//
// SUPPORT_EMAIL is empty until a role address on the domain exists (it needs MX records; see the
// gap audit H5). Set NEXT_PUBLIC_SUPPORT_EMAIL at build time (e.g. support@scope-flow.tech); until
// then pages show SUPPORT_EMAIL_PENDING and security.txt is not served. Never put a personal inbox here.
export const SUPPORT_EMAIL: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || '';
export const SUPPORT_EMAIL_PENDING = 'support email coming soon';
/** Who runs the service, as the legal pages name them. */
export const OPERATOR = 'VijeyaHasen';
/** Public site origin for metadata, robots.txt and the sitemap: APP_URL, else the production host. */
export const SITE_ORIGIN_FALLBACK = 'https://scope-flow.tech';
/** Public pages listed in the sitemap (M10). Private shells and token pages are never listed. */
export const PUBLIC_PAGES = ['/', '/plans', '/msme-interest', '/reviewer-guide', '/about', '/contact', '/support', '/privacy', '/terms', '/refund'] as const;
/** Paths crawlers are asked to skip (M10): APIs, bearer-token pages and signed-in shells. */
export const ROBOTS_DISALLOW = ['/api/', '/review/', '/cosign/', '/pay/', '/share', '/oauth/', '/workspace', '/account', '/onboarding', '/templates', '/connect', '/auth/', '/verify', '/payment-return', '/plans/checkout', '/plans/invoices'] as const;
