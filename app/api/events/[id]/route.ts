import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseRequest } from '@/src/lib/server-auth';
import { deleteUserCollection, saveUserCollection, type EventCollectionRecord } from '@/src/db/events';
import { eventCollectionPayloadSchema } from '@/lib/event-collections';

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await verifyFirebaseRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required to update event collections.' }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'Invalid collection ID.' }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = eventCollectionPayloadSchema.safeParse({
    ...(typeof raw === 'object' && raw ? raw : {}),
    id,
  });
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
      id,
      subEvents: data.subEvents.map((s, idx) => ({ ...s, collectionId: id, sortOrder: idx })),
      vendors: data.vendors.map((v) => ({ ...v, collectionId: id, subEventId: v.subEventId ?? null })),
    };
    const saved = await saveUserCollection(user.uid, record);
    return NextResponse.json({ collection: saved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('PUT /api/events/[id] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update event collection.' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await verifyFirebaseRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required to delete event collections.' }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'Invalid collection ID.' }, { status: 400 });
  }
  try {
    const removed = await deleteUserCollection(user.uid, id);
    return NextResponse.json({ deleted: removed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('DELETE /api/events/[id] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete event collection.' },
      { status: 500 },
    );
  }
}
