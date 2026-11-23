import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseRequest } from '@/src/lib/server-auth';
import { listUserCollections, saveUserCollection, type EventCollectionRecord } from '@/src/db/events';
import { eventCollectionPayloadSchema } from '@/lib/event-collections';

export async function GET(req: NextRequest) {
  const user = await verifyFirebaseRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required to load saved event collections.' }, { status: 401 });
  }
  try {
    const collections = await listUserCollections(user.uid);
    return NextResponse.json({ collections }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('GET /api/events failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load event collections.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyFirebaseRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required to save event collections.' }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }
  const parsed = eventCollectionPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please check your event collection fields.', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  try {
    const data = parsed.data;
    const record: EventCollectionRecord = {
      ...data,
      subEvents: data.subEvents.map((s, idx) => ({ ...s, collectionId: data.id, sortOrder: idx })),
      vendors: data.vendors.map((v) => ({ ...v, collectionId: data.id, subEventId: v.subEventId ?? null })),
    };
    const saved = await saveUserCollection(user.uid, record);
    return NextResponse.json({ collection: saved }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('POST /api/events failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save event collection.' },
      { status: 500 },
    );
  }
}
