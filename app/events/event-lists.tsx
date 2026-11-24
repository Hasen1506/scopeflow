'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import { FileSignature, MessageCircle, Phone, Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/currency';
import {
  buildVendorWhatsAppConfirm,
  sanitizePhoneDigits,
  SUB_EVENT_STATUS_LABEL,
  VENDOR_CATEGORY_META,
  VENDOR_STATUS_LABEL,
  type EventCollection,
  type EventVendor,
  type SubEvent,
  type SubEventStatus,
  type VendorAgreementStatus,
} from '@/lib/event-collections';

export type SubEventCardProps = {
  sub: SubEvent;
  index: number;
  linkedCount: number;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (subId: string) => void;
  onToggleEdit: (subId: string) => void;
  onUpdate: (subId: string, patch: Partial<SubEvent>) => void;
  onRemove: (subId: string) => void;
};

export const SubEventCard = memo(function SubEventCard({
  sub,
  index,
  linkedCount,
  isSelected,
  isEditing,
  onSelect,
  onToggleEdit,
  onUpdate,
  onRemove,
}: SubEventCardProps) {
  const primaryMeta = [sub.venueName, sub.guestCount > 0 ? `${sub.guestCount} guests` : '']
    .filter(Boolean)
    .join(' · ');
  const timeMeta = [sub.eventDate, sub.timeSlot].filter(Boolean).join(' · ');

  return (
    <li className={`events-sub-card${isSelected ? ' is-selected' : ''}`}>
      <button type="button" className="events-sub-select" onClick={() => onSelect(sub.id)}>
        <div className="events-sub-item-top">
          <span className="events-sub-num">{String(index + 1).padStart(2, '0')}.</span>
          <strong>{sub.title}</strong>
          <span className={`events-status-tag is-${sub.status}`}>
            {SUB_EVENT_STATUS_LABEL[sub.status]}
          </span>
        </div>
        <div className="events-sub-meta">
          {primaryMeta && <span>{primaryMeta}</span>}
          {timeMeta && <span>{timeMeta}</span>}
          {sub.coordinatorName && (
            <span>
              Coord: {sub.coordinatorName}
              {sub.coordinatorPhone ? ` (${sub.coordinatorPhone})` : ''}
            </span>
          )}
        </div>
      </button>

      <div className="events-sub-foot">
        <span className="fine">
          {linkedCount} vendor{linkedCount === 1 ? '' : 's'}
        </span>
        <button type="button" className="help-link" onClick={() => onToggleEdit(sub.id)}>
          {isEditing ? 'Done editing' : 'Edit details'}
        </button>
      </div>

      {isEditing && (
        <div className="events-sub-edit">
          <label>
            Sub-event title
            <input
              value={sub.title}
              onChange={(e) => onUpdate(sub.id, { title: e.target.value })}
            />
          </label>
          <div className="two-col">
            <label>
              Date
              <input
                type="date"
                value={sub.eventDate}
                onChange={(e) => onUpdate(sub.id, { eventDate: e.target.value })}
              />
            </label>
            <label>
              Guests
              <input
                type="number"
                min={0}
                value={sub.guestCount}
                onChange={(e) =>
                  onUpdate(sub.id, { guestCount: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
          </div>
          <label>
            Time slot
            <input
              value={sub.timeSlot}
              onChange={(e) => onUpdate(sub.id, { timeSlot: e.target.value })}
            />
          </label>
          <label>
            Venue
            <input
              value={sub.venueName}
              onChange={(e) => onUpdate(sub.id, { venueName: e.target.value })}
            />
          </label>
          <div className="two-col">
            <label>
              Coordinator name
              <input
                value={sub.coordinatorName}
                onChange={(e) => onUpdate(sub.id, { coordinatorName: e.target.value })}
              />
            </label>
            <label>
              Coordinator phone
              <input
                type="tel"
                value={sub.coordinatorPhone}
                onChange={(e) => onUpdate(sub.id, { coordinatorPhone: e.target.value })}
              />
            </label>
          </div>
          <label>
            Status
            <select
              value={sub.status}
              onChange={(e) => onUpdate(sub.id, { status: e.target.value as SubEventStatus })}
            >
              <option value="planning">Planning</option>
              <option value="locked">Locked</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => onRemove(sub.id)}>
              <Trash2 size={13} aria-hidden="true" /> Remove sub-event
            </button>
          </div>
        </div>
      )}
    </li>
  );
});

export type SubEventListProps = {
  subEvents: readonly SubEvent[];
  vendorCountBySubEvent: ReadonlyMap<string, number>;
  selectedSubId: string;
  editingSubId: string | null;
  onSelect: (subId: string) => void;
  onToggleEdit: (subId: string) => void;
  onUpdate: (subId: string, patch: Partial<SubEvent>) => void;
  onRemove: (subId: string) => void;
};

export const SubEventList = memo(function SubEventList({
  subEvents,
  vendorCountBySubEvent,
  selectedSubId,
  editingSubId,
  onSelect,
  onToggleEdit,
  onUpdate,
  onRemove,
}: SubEventListProps) {
  return (
    <ul className="events-sub-list">
      {subEvents.map((sub, idx) => (
        <SubEventCard
          key={sub.id}
          sub={sub}
          index={idx}
          linkedCount={vendorCountBySubEvent.get(sub.id) ?? 0}
          isSelected={selectedSubId === sub.id}
          isEditing={editingSubId === sub.id}
          onSelect={onSelect}
          onToggleEdit={onToggleEdit}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
});

export type VendorCardProps = {
  vendor: EventVendor;
  collectionMeta: Pick<
    EventCollection,
    'id' | 'title' | 'city' | 'currency' | 'jurisdiction' | 'primaryContactName' | 'primaryContactPhone' | 'kind' | 'startDate' | 'endDate' | 'notes'
  >;
  subEvent: SubEvent | undefined;
  subEvents: readonly SubEvent[];
  isEditing: boolean;
  onUpdate: (vendorId: string, patch: Partial<EventVendor>) => void;
  onRemove: (vendorId: string) => void;
  onToggleEdit: (vendorId: string) => void;
  onOpenEditor: (vendor: EventVendor) => void;
  onCopyConfirm: (vendor: EventVendor) => void;
};

const EMPTY_VENDORS: EventVendor[] = [];

export const VendorCard = memo(function VendorCard({
  vendor,
  collectionMeta,
  subEvent,
  subEvents,
  isEditing,
  onUpdate,
  onRemove,
  onToggleEdit,
  onOpenEditor,
  onCopyConfirm,
}: VendorCardProps) {
  const balance = Math.max(0, vendor.agreedFee - vendor.advancePaid);
  const catMeta = VENDOR_CATEGORY_META[vendor.category] ?? VENDOR_CATEGORY_META.other;

  const waHref = useMemo(() => {
    const scopeCollection: EventCollection = {
      ...collectionMeta,
      subEvents: subEvent ? [subEvent] : [],
      vendors: EMPTY_VENDORS,
    };
    return buildVendorWhatsAppConfirm(scopeCollection, vendor).waHref;
  }, [collectionMeta, subEvent, vendor]);

  return (
    <li className={`events-vendor-card is-${vendor.agreementStatus}`}>
      <div className="events-vendor-head">
        <div>
          <div className="events-vendor-kicker">
            <span>{catMeta.label}</span>
            <span aria-hidden="true"> · </span>
            <span>{subEvent ? subEvent.title : 'All sub-events'}</span>
          </div>
          <h3>{vendor.vendorName}</h3>
        </div>

        <select
          aria-label={`Agreement status for ${vendor.vendorName}`}
          className={`events-status-select is-${vendor.agreementStatus}`}
          value={vendor.agreementStatus}
          onChange={(e) =>
            onUpdate(vendor.id, {
              agreementStatus: e.target.value as VendorAgreementStatus,
            })
          }
        >
          {Object.entries(VENDOR_STATUS_LABEL).map(([val, lbl]) => (
            <option key={val} value={val}>
              {lbl}
            </option>
          ))}
        </select>
      </div>

      <div className="events-vendor-contacts">
        {vendor.contactPerson && (
          <span>
            <strong>Contact:</strong> {vendor.contactPerson}
          </span>
        )}
        {vendor.contactPhone && (
          <a className="help-link" href={`tel:${sanitizePhoneDigits(vendor.contactPhone)}`}>
            <Phone size={13} aria-hidden="true" /> {vendor.contactPhone}
          </a>
        )}
        {vendor.contactEmail && <span className="events-vendor-meta">{vendor.contactEmail}</span>}
        {vendor.utrReference && (
          <span className="events-vendor-meta">
            <strong>UTR:</strong> {vendor.utrReference}
          </span>
        )}
      </div>

      <div className="events-vendor-money">
        <div>
          <span>Agreed Fee</span>
          <strong>{formatMoney(vendor.agreedFee, collectionMeta.currency)}</strong>
        </div>
        <div>
          <span>Advance Paid</span>
          <strong>{formatMoney(vendor.advancePaid, collectionMeta.currency)}</strong>
        </div>
        <div>
          <span>Balance Due</span>
          <strong className={balance === 0 ? 'is-ok' : undefined}>
            {formatMoney(balance, collectionMeta.currency)}
          </strong>
        </div>
      </div>

      {vendor.clauseSummary && <p className="events-vendor-terms">{vendor.clauseSummary}</p>}

      <div className="events-vendor-actions">
        <div className="events-vendor-primary-actions">
          <a
            className="primary events-compact-btn"
            href={waHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              if (vendor.agreementStatus === 'draft') {
                onUpdate(vendor.id, { agreementStatus: 'whatsapp-sent' });
              }
            }}
          >
            <MessageCircle size={14} aria-hidden="true" />
            <span>WhatsApp Confirm</span>
          </a>
          <button
            type="button"
            className="secondary events-compact-btn"
            onClick={() => onOpenEditor(vendor)}
          >
            <FileSignature size={14} aria-hidden="true" />
            <span>Full agreement</span>
          </button>
        </div>
        <div className="events-vendor-utils">
          <button
            type="button"
            className="help-link"
            onClick={() => onCopyConfirm(vendor)}
          >
            Copy recap
          </button>
          <span aria-hidden="true">·</span>
          <Link className="help-link" href="/check">
            Scan quote
          </Link>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="help-link"
            onClick={() => onToggleEdit(vendor.id)}
          >
            {isEditing ? 'Close edit' : 'Edit'}
          </button>
        </div>
      </div>

      {isEditing && (
        <div className="events-vendor-edit">
          <div className="two-col">
            <label>
              Vendor name
              <input
                value={vendor.vendorName}
                onChange={(e) => onUpdate(vendor.id, { vendorName: e.target.value })}
              />
            </label>
            <label>
              Sub-event
              <select
                value={vendor.subEventId ?? ''}
                onChange={(e) => onUpdate(vendor.id, { subEventId: e.target.value || null })}
              >
                <option value="">All sub-events</option>
                {subEvents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-col">
            <label>
              Contact person
              <input
                value={vendor.contactPerson}
                onChange={(e) => onUpdate(vendor.id, { contactPerson: e.target.value })}
              />
            </label>
            <label>
              Phone / WhatsApp
              <input
                type="tel"
                value={vendor.contactPhone}
                onChange={(e) =>
                  onUpdate(vendor.id, {
                    contactPhone: e.target.value,
                    whatsappNumber: e.target.value,
                  })
                }
              />
            </label>
          </div>
          <div className="three-col">
            <label>
              Agreed fee
              <input
                type="number"
                min={0}
                value={vendor.agreedFee}
                onChange={(e) =>
                  onUpdate(vendor.id, {
                    agreedFee: Math.max(0, Math.round(Number(e.target.value) || 0)),
                  })
                }
              />
            </label>
            <label>
              Advance paid
              <input
                type="number"
                min={0}
                value={vendor.advancePaid}
                onChange={(e) =>
                  onUpdate(vendor.id, {
                    advancePaid: Math.max(0, Math.round(Number(e.target.value) || 0)),
                  })
                }
              />
            </label>
            <label>
              UTR / Bank ref
              <input
                value={vendor.utrReference}
                onChange={(e) => onUpdate(vendor.id, { utrReference: e.target.value })}
              />
            </label>
          </div>
          <label>
            Key protective terms
            <textarea
              rows={2}
              value={vendor.clauseSummary}
              onChange={(e) => onUpdate(vendor.id, { clauseSummary: e.target.value })}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => onRemove(vendor.id)}
            >
              <Trash2 size={13} aria-hidden="true" /> Remove vendor
            </button>
          </div>
        </div>
      )}
    </li>
  );
});

export type VendorListProps = {
  vendors: readonly EventVendor[];
  collectionMeta: VendorCardProps['collectionMeta'];
  subEventById: ReadonlyMap<string, SubEvent>;
  subEvents: readonly SubEvent[];
  editingVendorId: string | null;
  onUpdate: (vendorId: string, patch: Partial<EventVendor>) => void;
  onRemove: (vendorId: string) => void;
  onToggleEdit: (vendorId: string) => void;
  onOpenEditor: (vendor: EventVendor) => void;
  onCopyConfirm: (vendor: EventVendor) => void;
};

export const VendorList = memo(function VendorList({
  vendors,
  collectionMeta,
  subEventById,
  subEvents,
  editingVendorId,
  onUpdate,
  onRemove,
  onToggleEdit,
  onOpenEditor,
  onCopyConfirm,
}: VendorListProps) {
  return (
    <ul className="events-vendor-list">
      {vendors.map((v) => (
        <VendorCard
          key={v.id}
          vendor={v}
          collectionMeta={collectionMeta}
          subEvent={v.subEventId ? subEventById.get(v.subEventId) : undefined}
          subEvents={subEvents}
          isEditing={editingVendorId === v.id}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onToggleEdit={onToggleEdit}
          onOpenEditor={onOpenEditor}
          onCopyConfirm={onCopyConfirm}
        />
      ))}
    </ul>
  );
});
