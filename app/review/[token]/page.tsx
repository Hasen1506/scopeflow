import {headers} from 'next/headers';
import {isLang, parseAcceptLanguage} from '@/lib/i18n/core';
import Review from './review';
export const metadata={title:'Review a scope — Scopeflow',robots:{index:false,follow:false},referrer:'no-referrer'};
// SF-09: the first paint is already in the reader's language: ?lang= when given, else the browser's
// Accept-Language (the reader's own saved choice and the creator's scope language apply once loaded).
export default async function Page({params,searchParams}:{params:Promise<{token:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const [{token},query,h]=await Promise.all([params,searchParams,headers()]);
 const lang=Array.isArray(query.lang)?query.lang[0]:query.lang;
 return <Review token={token} queryLang={isLang(lang)?lang:null} acceptLang={parseAcceptLanguage(h.get('accept-language'))}/>;
}
