import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from './index';
import { advisorMessages, eventCollections, eventVendors, subEvents } from './schema';

export interface SubEventRecord {
  id: string;
  collectionId: string;
  sortOrder: number;
  title: string;
  eventDate: string;
  timeSlot: string;
  venueName: string;
  venueAddress: string;
  guestCount: number;
  coordinatorName: string;
  coordinatorPhone: string;
  status: string;
  notes: string;
}

export interface EventVendorRecord {
  id: string;
  collectionId: string;
  subEventId: string | null;
  category: string;
  vendorName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  whatsappNumber: string;
  agreedFee: number;
  advancePaid: number;
  paymentDueDate: string;
  utrReference: string;
  agreementStatus: string;
  clauseSummary: string;
  deliverables: string;
}

export interface EventCollectionRecord {
  id: string;
  kind: string;
  title: string;
  jurisdiction: string;
  currency: string;
  startDate: string;
  endDate: string;
  city: string;
  primaryContactName: string;
  primaryContactPhone: string;
  notes: string;
  subEvents: SubEventRecord[];
  vendors: EventVendorRecord[];
}

export async function listUserCollections(ownerUid: string): Promise<EventCollectionRecord[]> {
  try {
    const cols = await db
      .select()
      .from(eventCollections)
      .where(eq(eventCollections.ownerUid, ownerUid))
      .orderBy(desc(eventCollections.updatedAt));

    if (!cols.length) return [];

    const subs = await db
      .select()
      .from(subEvents)
      .where(eq(subEvents.ownerUid, ownerUid))
      .orderBy(asc(subEvents.sortOrder), asc(subEvents.createdAt));

    const vends = await db
      .select()
      .from(eventVendors)
      .where(eq(eventVendors.ownerUid, ownerUid))
      .orderBy(asc(eventVendors.createdAt));

    return cols.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      jurisdiction: c.jurisdiction,
      currency: c.currency,
      startDate: c.startDate ?? '',
      endDate: c.endDate ?? '',
      city: c.city ?? '',
      primaryContactName: c.primaryContactName ?? '',
      primaryContactPhone: c.primaryContactPhone ?? '',
      notes: c.notes ?? '',
      subEvents: subs
        .filter((s) => s.collectionId === c.id)
        .map((s) => ({
          id: s.id,
          collectionId: s.collectionId,
          sortOrder: s.sortOrder,
          title: s.title,
          eventDate: s.eventDate ?? '',
          timeSlot: s.timeSlot ?? '',
          venueName: s.venueName ?? '',
          venueAddress: s.venueAddress ?? '',
          guestCount: s.guestCount,
          coordinatorName: s.coordinatorName ?? '',
          coordinatorPhone: s.coordinatorPhone ?? '',
          status: s.status,
          notes: s.notes ?? '',
        })),
      vendors: vends
        .filter((v) => v.collectionId === c.id)
        .map((v) => ({
          id: v.id,
          collectionId: v.collectionId,
          subEventId: v.subEventId ?? null,
          category: v.category,
          vendorName: v.vendorName,
          contactPerson: v.contactPerson ?? '',
          contactPhone: v.contactPhone ?? '',
          contactEmail: v.contactEmail ?? '',
          whatsappNumber: v.whatsappNumber ?? '',
          agreedFee: v.agreedFee,
          advancePaid: v.advancePaid,
          paymentDueDate: v.paymentDueDate ?? '',
          utrReference: v.utrReference ?? '',
          agreementStatus: v.agreementStatus,
          clauseSummary: v.clauseSummary ?? '',
          deliverables: v.deliverables ?? '',
        })),
    }));
  } catch (error) {
    console.error('Failed to list event collections:', error);
    throw new Error('Could not load your event collections. Please try again.', { cause: error });
  }
}

export async function saveUserCollection(ownerUid: string, input: EventCollectionRecord): Promise<EventCollectionRecord> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(eventCollections)
        .values({
          id: input.id,
          ownerUid,
          kind: input.kind,
          title: input.title,
          jurisdiction: input.jurisdiction,
          currency: input.currency,
          startDate: input.startDate,
          endDate: input.endDate,
          city: input.city,
          primaryContactName: input.primaryContactName,
          primaryContactPhone: input.primaryContactPhone,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: eventCollections.id,
          set: {
            kind: input.kind,
            title: input.title,
            jurisdiction: input.jurisdiction,
            currency: input.currency,
            startDate: input.startDate,
            endDate: input.endDate,
            city: input.city,
            primaryContactName: input.primaryContactName,
            primaryContactPhone: input.primaryContactPhone,
            notes: input.notes,
            updatedAt: new Date(),
          },
        });

      await tx
        .delete(eventVendors)
        .where(and(eq(eventVendors.collectionId, input.id), eq(eventVendors.ownerUid, ownerUid)));
      await tx
        .delete(subEvents)
        .where(and(eq(subEvents.collectionId, input.id), eq(subEvents.ownerUid, ownerUid)));

      if (input.subEvents.length > 0) {
        await tx.insert(subEvents).values(
          input.subEvents.map((s, idx) => ({
            id: s.id,
            collectionId: input.id,
            ownerUid,
            sortOrder: idx,
            title: s.title,
            eventDate: s.eventDate,
            timeSlot: s.timeSlot,
            venueName: s.venueName,
            venueAddress: s.venueAddress,
            guestCount: Math.max(0, Math.round(Number(s.guestCount) || 0)),
            coordinatorName: s.coordinatorName,
            coordinatorPhone: s.coordinatorPhone,
            status: s.status,
            notes: s.notes,
          })),
        );
      }

      const validSubIds = new Set(input.subEvents.map((s) => s.id));
      if (input.vendors.length > 0) {
        await tx.insert(eventVendors).values(
          input.vendors.map((v) => ({
            id: v.id,
            collectionId: input.id,
            subEventId: v.subEventId && validSubIds.has(v.subEventId) ? v.subEventId : null,
            ownerUid,
            category: v.category,
            vendorName: v.vendorName,
            contactPerson: v.contactPerson,
            contactPhone: v.contactPhone,
            contactEmail: v.contactEmail,
            whatsappNumber: v.whatsappNumber,
            agreedFee: Math.max(0, Math.round(Number(v.agreedFee) || 0)),
            advancePaid: Math.max(0, Math.round(Number(v.advancePaid) || 0)),
            paymentDueDate: v.paymentDueDate,
            utrReference: v.utrReference,
            agreementStatus: v.agreementStatus,
            clauseSummary: v.clauseSummary,
            deliverables: v.deliverables,
            updatedAt: new Date(),
          })),
        );
      }
    });
    return input;
  } catch (error) {
    console.error('Failed to save event collection:', error);
    throw new Error('Could not save your event collection. Please try again.', { cause: error });
  }
}

export async function deleteUserCollection(ownerUid: string, collectionId: string): Promise<boolean> {
  try {
    const deleted = await db
      .delete(eventCollections)
      .where(and(eq(eventCollections.id, collectionId), eq(eventCollections.ownerUid, ownerUid)))
      .returning({ id: eventCollections.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Failed to delete event collection:', error);
    throw new Error('Could not delete this event collection. Please try again.', { cause: error });
  }
}

export async function listAdvisorMessages(ownerUid: string, limit = 40) {
  try {
    const rows = await db
      .select()
      .from(advisorMessages)
      .where(eq(advisorMessages.ownerUid, ownerUid))
      .orderBy(desc(advisorMessages.createdAt))
      .limit(limit);
    return rows.reverse();
  } catch (error) {
    console.error('Failed to load advisor messages:', error);
    throw new Error('Could not load your previous conversation.', { cause: error });
  }
}

export async function appendAdvisorTurn(
  ownerUid: string,
  userContent: string,
  assistantContent: string,
  opts: { persona: string; model: string; collectionId?: string | null },
) {
  try {
    await db.insert(advisorMessages).values([
      {
        ownerUid,
        collectionId: opts.collectionId ?? null,
        persona: opts.persona,
        role: 'user',
        content: userContent,
        model: opts.model,
      },
      {
        ownerUid,
        collectionId: opts.collectionId ?? null,
        persona: opts.persona,
        role: 'assistant',
        content: assistantContent,
        model: opts.model,
      },
    ]);
  } catch (error) {
    console.error('Failed to persist advisor turn:', error);
    throw new Error('Could not save your conversation turn.', { cause: error });
  }
}

export async function clearAdvisorMessages(ownerUid: string) {
  try {
    await db.delete(advisorMessages).where(eq(advisorMessages.ownerUid, ownerUid));
  } catch (error) {
    console.error('Failed to clear advisor messages:', error);
    throw new Error('Could not clear your conversation history.', { cause: error });
  }
}
