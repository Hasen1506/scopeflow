import SharedTemplate from './shared';
export const metadata = {title: 'Shared template · Scopeflow', robots: {index: false}};
export default async function Page({params}: {params: Promise<{token: string}>}) { return <SharedTemplate token={(await params).token} />; }
