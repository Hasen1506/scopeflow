import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format')?.toLowerCase() === 'jpg' ? 'jpg' : 'svg';
  const filename = format === 'jpg' ? 'termslock-logo.jpg' : 'termslock-logo.svg';
  const downloadName = format === 'jpg' ? 'contractlock-logo.jpg' : 'contractlock-logo.svg';
  const contentType = format === 'jpg' ? 'image/jpeg' : 'image/svg+xml; charset=utf-8';
  const filePath = path.join(process.cwd(), 'public', filename);

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Logo asset not found.' }, { status: 404 });
  }
}
