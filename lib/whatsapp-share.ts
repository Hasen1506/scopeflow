// WhatsApp share links (LT-03, SF-01; WS-06). Isomorphic and pure: the WhatsAppShare component and
// the server build the same wa.me link. https://wa.me/<E.164 digits>?text=<encoded>, or
// https://wa.me/?text=… when there is no phone so the owner picks the chat. ScopeFlow sends nothing:
// the link opens the owner's own WhatsApp with a polite prefilled message (en, hi, ta).

export type ShareLang = 'en' | 'hi' | 'ta';
export const SHARE_LANGS: readonly ShareLang[] = ['en', 'hi', 'ta'];
export type ShareKind = 'scope' | 'change_order' | 'invoice' | 'reminder';

/** The digits of an E.164 number, or '' when it is not one ("+91 98765-43210" -> "919876543210"). */
export function waDigits(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/[\s().+-]/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

/** https://wa.me/<digits>?text=… (or https://wa.me/?text=… to let the owner pick the chat). */
export function waLink(phone: string | null | undefined, text: string) {
  const digits = waDigits(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text.normalize('NFC').slice(0, 3000))}`;
}

export type ShareValues = {client?: string; title?: string; link: string; seller?: string; seq?: number; co_title?: string; amount?: string; number?: string; due?: string; days?: number};
const clean = (v: unknown, max = 160) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

type Template = (v: Required<Pick<ShareValues, 'link'>> & Record<string, string>) => string;
const TEMPLATES: Record<ShareLang, Record<ShareKind, Template>> = {
  en: {
    scope: v => `Hi ${v.client || 'there'},\n\nThe scope of work for "${v.title}" is ready for your review. You can read it and approve it (or ask for changes) here:\n${v.link}\n\nThank you!${v.seller ? `\n${v.seller}` : ''}`,
    change_order: v => `Hi ${v.client || 'there'},\n\nI've proposed change order CO-${v.seq} "${v.co_title}" for "${v.title}"${v.amount ? ` (${v.amount})` : ''}. It only applies if you approve it:\n${v.link}\n\nThank you!${v.seller ? `\n${v.seller}` : ''}`,
    invoice: v => `Hi ${v.client || 'there'},\n\nInvoice ${v.number} for "${v.title}" is ready${v.amount ? `: ${v.amount}` : ''}${v.due ? `, due ${v.due}` : ''}. The invoice and the statement are here:\n${v.link}\n\nThank you!${v.seller ? `\n${v.seller}` : ''}`,
    reminder: v => `Hi ${v.client || 'there'},\n\nA gentle reminder about ${v.number ? `invoice ${v.number}` : `"${v.title}"`}${v.amount ? ` (${v.amount} open)` : ''}. Everything is here:\n${v.link}\n\nIf it's already done, thank you, and please ignore this.${v.seller ? `\n${v.seller}` : ''}`,
  },
  hi: {
    scope: v => `नमस्ते ${v.client || 'जी'},\n\n"${v.title}" के काम का विवरण (स्कोप) आपकी समीक्षा के लिए तैयार है। आप इसे यहाँ पढ़कर स्वीकृत कर सकते हैं (या बदलाव माँग सकते हैं):\n${v.link}\n\nधन्यवाद!${v.seller ? `\n${v.seller}` : ''}`,
    change_order: v => `नमस्ते ${v.client || 'जी'},\n\nमैंने "${v.title}" के लिए बदलाव आदेश CO-${v.seq} "${v.co_title}"${v.amount ? ` (${v.amount})` : ''} भेजा है। यह आपकी स्वीकृति के बाद ही लागू होगा:\n${v.link}\n\nधन्यवाद!${v.seller ? `\n${v.seller}` : ''}`,
    invoice: v => `नमस्ते ${v.client || 'जी'},\n\n"${v.title}" का इनवॉइस ${v.number} तैयार है${v.amount ? `: ${v.amount}` : ''}${v.due ? `, देय तिथि ${v.due}` : ''}। इनवॉइस और विवरण यहाँ हैं:\n${v.link}\n\nधन्यवाद!${v.seller ? `\n${v.seller}` : ''}`,
    reminder: v => `नमस्ते ${v.client || 'जी'},\n\n${v.number ? `इनवॉइस ${v.number}` : `"${v.title}"`} के बारे में एक विनम्र याद दिलाना${v.amount ? ` (${v.amount} बाकी)` : ''}। सब कुछ यहाँ है:\n${v.link}\n\nअगर यह हो चुका है, तो धन्यवाद, कृपया इसे अनदेखा करें।${v.seller ? `\n${v.seller}` : ''}`,
  },
  ta: {
    scope: v => `வணக்கம் ${v.client || ''},\n\n"${v.title}" பணியின் விவரம் (ஸ்கோப்) உங்கள் பார்வைக்குத் தயாராக உள்ளது. இங்கே படித்து ஒப்புதல் அளிக்கலாம் (அல்லது மாற்றங்களைக் கேட்கலாம்):\n${v.link}\n\nநன்றி!${v.seller ? `\n${v.seller}` : ''}`,
    change_order: v => `வணக்கம் ${v.client || ''},\n\n"${v.title}" க்கான மாற்ற ஆணை CO-${v.seq} "${v.co_title}"${v.amount ? ` (${v.amount})` : ''} அனுப்பியுள்ளேன். நீங்கள் ஒப்புதல் அளித்தால் மட்டுமே இது நடைமுறைக்கு வரும்:\n${v.link}\n\nநன்றி!${v.seller ? `\n${v.seller}` : ''}`,
    invoice: v => `வணக்கம் ${v.client || ''},\n\n"${v.title}" க்கான விலைப்பட்டியல் ${v.number} தயார்${v.amount ? `: ${v.amount}` : ''}${v.due ? `, செலுத்த வேண்டிய நாள் ${v.due}` : ''}. விலைப்பட்டியலும் கணக்கு அறிக்கையும் இங்கே:\n${v.link}\n\nநன்றி!${v.seller ? `\n${v.seller}` : ''}`,
    reminder: v => `வணக்கம் ${v.client || ''},\n\n${v.number ? `விலைப்பட்டியல் ${v.number}` : `"${v.title}"`} பற்றிய ஒரு மென்மையான நினைவூட்டல்${v.amount ? ` (${v.amount} நிலுவை)` : ''}. அனைத்தும் இங்கே:\n${v.link}\n\nஏற்கனவே செலுத்தியிருந்தால் நன்றி, இதைப் புறக்கணிக்கவும்.${v.seller ? `\n${v.seller}` : ''}`,
  },
};

/** The polite prefilled message for a share, in the client's language (en when unknown). */
export function shareMessage(kind: ShareKind, values: ShareValues, lang: string | null | undefined = 'en') {
  const l: ShareLang = (SHARE_LANGS as readonly string[]).includes(lang ?? '') ? lang as ShareLang : 'en';
  const v: Record<string, string> = {client: clean(values.client, 120), title: clean(values.title), seller: clean(values.seller, 120), seq: clean(values.seq ?? '', 6), co_title: clean(values.co_title), amount: clean(values.amount, 60), number: clean(values.number, 40), due: clean(values.due, 40), days: clean(values.days ?? '', 6)};
  return TEMPLATES[l][kind]({...v, link: values.link});
}
