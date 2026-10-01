import Review from './review';
export const metadata={title:'Review a scope — Scopeflow',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Review token={token}/>;}
