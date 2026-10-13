import {CosignPage} from './cosign-page';
export const metadata = {title: 'Countersign — Scopeflow', robots: {index: false, follow: false}, referrer: 'no-referrer'};
export default async function Page({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  return <CosignPage token={token} />;
}
