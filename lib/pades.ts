import {createHash, createPrivateKey, sign as signBytes, X509Certificate, type KeyObject} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {concat, ctx, hex, int, nul, octets, oid, parse, seq, set, tlv} from './der';
import {requestTimestamp, tsaConfig} from './tsa';

// PAdES signatures on Scopeflow's PDFs (receipts, statements, invoices). With a document-signing
// certificate configured (for example an Indian Class 3 document-signer DSC issued to the operator),
// every PDF download is signed so Acrobat and other readers show who issued it and that it has not
// been changed since: an ETSI.CAdES.detached signature (PAdES B-B), plus an RFC 3161 signature
// timestamp (B-T) when SCOPEFLOW_TSA_URL is set.
//
// SCOPEFLOW_PDF_SIGN_CERT: PEM certificate (the signing certificate first, then any chain), inline or
// a file path. SCOPEFLOW_PDF_SIGN_KEY: its PEM private key (RSA or EC), inline or a file path.
// SCOPEFLOW_PDF_SIGN_KEY_PASSPHRASE (optional). Without them PDFs are served unsigned.
// The signature is appended as an incremental update, so the original bytes are unchanged.

type Env = Record<string, string | undefined>;
export type PadesConfig = {key: KeyObject; certs: Uint8Array[]; name: string};

const pemOrFile = (v: string) => (v.includes('-----BEGIN') ? v : readFileSync(v, 'utf8')).replace(/\\n/g, '\n');
export function padesConfig(env: Env = process.env): PadesConfig | null {
  const certPem = env.SCOPEFLOW_PDF_SIGN_CERT?.trim(), keyPem = env.SCOPEFLOW_PDF_SIGN_KEY?.trim();
  if (!certPem || !keyPem) return null;
  try {
    const pem = pemOrFile(certPem);
    const certs = [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map(m => new Uint8Array(new X509Certificate(m[0]).raw));
    if (!certs.length) return null;
    const key = createPrivateKey({key: pemOrFile(keyPem), passphrase: env.SCOPEFLOW_PDF_SIGN_KEY_PASSPHRASE || undefined});
    const cn = /CN=([^\n,]+)/.exec(new X509Certificate(Buffer.from(certs[0])).subject)?.[1] ?? 'Scopeflow';
    return {key, certs, name: cn};
  } catch (e) {
    console.warn('Scopeflow PDF signing is misconfigured:', (e as Error).message);
    return null;
  }
}

const OID = {
  sha256: '2.16.840.1.101.3.4.2.1', data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStamp: '1.2.840.113549.1.9.16.2.14', rsaSha256: '1.2.840.113549.1.1.11', ecdsaSha256: '1.2.840.10045.4.3.2',
};
const attribute = (type: string, value: Uint8Array) => seq(oid(type), set(value));

/** issuer Name and serialNumber of a certificate, as raw DER. */
function issuerAndSerial(cert: Uint8Array) {
  const tbs = parse(cert).children![0].children!;
  const i = tbs[0].cls === 2 ? 1 : 0;
  return {serial: tbs[i].bytes, issuer: tbs[i + 2].bytes};
}

/** CMS SignedData (detached) over `digest`, as PAdES requires: signing-certificate-v2, no signing-time. */
export async function cmsSignature(digest: Uint8Array, config: PadesConfig, {timestamp = tsaConfig()}: {timestamp?: ReturnType<typeof tsaConfig>} = {}) {
  const cert = config.certs[0];
  const {serial, issuer} = issuerAndSerial(cert);
  const ec = config.key.asymmetricKeyType === 'ec';
  const essCertIdV2 = seq(octets(createHash('sha256').update(cert).digest()), seq(seq(tlv(0xa4, issuer)), serial));
  const attrs = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(digest)),
    attribute(OID.signingCertificateV2, seq(seq(essCertIdV2))),
  ];
  const signedAttrs = set(...attrs);
  const signature = new Uint8Array(signBytes('sha256', signedAttrs, config.key));
  let unsigned: Uint8Array[] = [];
  if (timestamp) {
    // B-T: an RFC 3161 timestamp over the signature value.
    const t = await requestTimestamp(createHash('sha256').update(signature).digest('hex'), timestamp);
    unsigned = [tlv(0xa1, attribute(OID.signatureTimeStamp, t.token))];
  }
  const signerInfo = seq(int(1), seq(issuer, serial), seq(oid(OID.sha256), nul()), concat(Uint8Array.of(0xa0), signedAttrs.subarray(1)),
    ec ? seq(oid(OID.ecdsaSha256)) : seq(oid(OID.rsaSha256), nul()), octets(signature), ...unsigned);
  const signedData = seq(int(1), set(seq(oid(OID.sha256), nul())), seq(oid(OID.data)), ctx(0, ...config.certs), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signedData));
}

const SIG_RESERVE = 24576; // bytes reserved for the CMS (certificates and a timestamp token fit)
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const pdfDate = (d: Date) => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
const pdfText = (s: string) => '(' + s.replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1') + ')';

/**
 * Appends a PAdES signature to a PDF produced by lib/pdf.ts as an incremental update: a signature
 * field on the first page, an updated catalog with the AcroForm, and the signature dictionary whose
 * /Contents is the CMS over every byte except /Contents itself.
 */
export async function signPdf(pdf: Uint8Array, config: PadesConfig, {reason = 'Issued by Scopeflow', location = '', now = new Date(), timestamp = tsaConfig()}: {reason?: string; location?: string; now?: Date; timestamp?: ReturnType<typeof tsaConfig>} = {}) {
  const text = latin1(pdf);
  const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)\s*%%EOF\s*$/.exec(text);
  if (!trailer) throw new Error('Not a PDF from this writer.');
  const size = Number(/\/Size (\d+)/.exec(trailer[1])![1]), root = Number(/\/Root (\d+) 0 R/.exec(trailer[1])![1]);
  const info = /\/Info (\d+) 0 R/.exec(trailer[1])?.[1];
  const prev = Number(trailer[2]);
  const object = (id: number) => new RegExp(`(?:^|\\n)${id} 0 obj\\n([\\s\\S]*?)\\nendobj`).exec(text)?.[1] ?? '';
  const catalog = object(root);
  const pagesId = Number(/\/Pages (\d+) 0 R/.exec(catalog)![1]);
  const firstPage = Number(/\/Kids \[(\d+) 0 R/.exec(object(pagesId))![1]);
  const sigId = size, widgetId = size + 1;
  const page = object(firstPage).replace(/>>\s*$/, ` /Annots [${widgetId} 0 R] >>`);
  const newCatalog = catalog.replace(/>>\s*$/, ` /AcroForm << /Fields [${widgetId} 0 R] /SigFlags 3 >> >>`);
  const placeholder = '0'.repeat(SIG_RESERVE * 2);
  const sigDict = `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${placeholder}> /M ${pdfText(pdfDate(now))} /Name ${pdfText(config.name)} /Reason ${pdfText(reason)}${location ? ` /Location ${pdfText(location)}` : ''} >>`;
  const widget = `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Scopeflow signature) /V ${sigId} 0 R /F 132 /Rect [0 0 0 0] /P ${firstPage} 0 R >>`;
  let out = text.endsWith('\n') ? text : text + '\n';
  const offsets: [number, number][] = [];
  for (const [id, body] of [[root, newCatalog], [firstPage, page], [sigId, sigDict], [widgetId, widget]] as [number, string][]) {
    offsets.push([id, Buffer.byteLength(out, 'latin1')]);
    out += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n' + offsets.sort((a, b) => a[0] - b[0]).map(([id, off]) => `${id} 1\n${String(off).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${size + 2} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''} /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
  // Byte ranges: everything except the hex string inside /Contents < >.
  const contentsAt = out.indexOf(`/Contents <${placeholder}>`) + '/Contents '.length;
  const contentsEnd = contentsAt + placeholder.length + 2;
  const range = [0, contentsAt, contentsEnd, Buffer.byteLength(out, 'latin1') - contentsEnd];
  out = out.replace('/ByteRange [0 0000000000 0000000000 0000000000]', `/ByteRange [0 ${range.slice(1).map(v => String(v).padStart(10, '0')).join(' ')}]`);
  const bytes = Buffer.from(out, 'latin1');
  const digest = createHash('sha256').update(bytes.subarray(0, contentsAt)).update(bytes.subarray(contentsEnd)).digest();
  const cms = await cmsSignature(new Uint8Array(digest), config, {timestamp});
  if (cms.length > SIG_RESERVE) throw new Error('The PDF signature is larger than the space reserved for it.');
  bytes.write(hex(cms).padEnd(placeholder.length, '0'), contentsAt + 1, 'latin1');
  return new Uint8Array(bytes);
}

/** Signs when a certificate is configured; otherwise returns the PDF unchanged. Never throws. */
export async function maybeSignPdf(pdf: Uint8Array, options: Parameters<typeof signPdf>[2] = {}) {
  const config = padesConfig();
  if (!config) return pdf;
  try { return await signPdf(pdf, config, options); }
  catch (e) {
    // A failed timestamp must not block the download: retry once without it (B-B), then serve unsigned.
    try { return await signPdf(pdf, config, {...options, timestamp: null}); }
    catch { console.warn('Scopeflow PDF signing failed:', (e as Error).message); return pdf; }
  }
}

