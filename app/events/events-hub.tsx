'use client';

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  Cloud,
  Download,
  HardDrive,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/src/lib/auth-context';
import { formatMoney } from '@/lib/currency';
import { JURISDICTIONS, type JurisdictionId } from '@/lib/legal-shield';
import { GUIDED_STASH_KEY } from '@/lib/protection-packs';
import {
  buildScopeFromEventVendor,
  buildVendorWhatsAppConfirm,
  cleanLegacyPhantomGuests,
  COLLECTION_BLUEPRINTS,
  computeCollectionTotals,
  createCollectionFromBlueprint,
  LOCAL_EVENTS_STORAGE_KEY,
  makeId,
  sanitizePhoneDigits,
  summarizeCollectionForAI,
  VENDOR_CATEGORY_META,
  type CollectionKind,
  type EventCollection,
  type EventVendor,
  type SubEvent,
  type VendorCategory,
} from '@/lib/event-collections';
import {
  buildSubEventBudgetComparison,
  buildSubEventStatusCounts,
  buildSubEventTitleMap,
  buildVendorCountBySubEvent,
  filterCollectionSubEvents,
  filterCollectionVendors,
  type SubEventStatusFilter,
} from '@/lib/event-list-selectors';
import { buildSubEventsCsv, buildSubEventsCsvFilename } from '@/lib/event-csv';
import { SubEventList, VendorList } from './event-lists';
import { SubEventStatusChart } from './sub-event-status-chart';
import { SubEventBudgetChart } from './sub-event-budget-chart';
import { openAdvisorDrawer } from '@/app/components/advisor-chat';
import { Skeleton } from '@/app/ui';

const SUB_STATUS_FILTER_OPTIONS: { value: SubEventStatusFilter; label: string; hint: string }[] = [
  { value: 'all', label: 'All sub-events', hint: 'Show every function or phase' },
  { value: 'upcoming', label: 'Upcoming sub-events', hint: 'Planning, Locked & Confirmed' },
  { value: 'completed', label: 'Completed sub-events', hint: 'Finished functions only' },
];

const CLOUD_EVENTS_CACHE_KEY = `${LOCAL_EVENTS_STORAGE_KEY}:cloud`;

function readStoredCollections(key: string): EventCollection[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EventCollection[];
    if (Array.isArray(parsed)) {
      return parsed.map((c) => cleanLegacyPhantomGuests(c));
    }
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

function writeStoredCollections(key: string, cols: EventCollection[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(cols));
  } catch {
    /* ignore quota */
  }
}

export default function EventsHub() {
  const router = useRouter();
  const { user, loading: authLoading, getFreshToken } = useAuth();

  // Start empty on SSR so signed-in users NEVER see a phantom "Eashwaren–Apoorva Wedding" flash.
  const [collections, setCollections] = useState<EventCollection[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [selectedSubId, setSelectedSubId] = useState<string>('all');
  const [subStatusFilter, setSubStatusFilter] = useState<SubEventStatusFilter>('all');
  const [viewMode, setViewMode] = useState<'vendors' | 'contacts'>('vendors');
  const [searchQuery, setSearchQuery] = useState('');
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);
  const [showEventDetails, setShowEventDetails] = useState(false);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [syncState, setSyncState] = useState<'local' | 'saving' | 'synced' | 'error'>('local');
  const [hydrated, setHydrated] = useState(false);

  // Quick-add sub-event draft
  const [newSubTitle, setNewSubTitle] = useState('');
  const [newSubDate, setNewSubDate] = useState('');
  const [newSubTime, setNewSubTime] = useState('');
  const [newSubVenue, setNewSubVenue] = useState('');
  const [newSubGuests, setNewSubGuests] = useState('');
  const [newSubCoord, setNewSubCoord] = useState('');
  const [newSubCoordPhone, setNewSubCoordPhone] = useState('');

  // Quick-add vendor draft
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCategory, setNewVendorCategory] = useState<VendorCategory>('catering');
  const [newVendorSubId, setNewVendorSubId] = useState<string>('');
  const [newVendorPerson, setNewVendorPerson] = useState('');
  const [newVendorPhone, setNewVendorPhone] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [newVendorFee, setNewVendorFee] = useState('');
  const [newVendorAdvance, setNewVendorAdvance] = useState('');
  const [newVendorUtr, setNewVendorUtr] = useState('');
  const [newVendorTerms, setNewVendorTerms] = useState('');

  // Pre-paint local load on mount: signed-in users hydrate ONLY from their cloud cache
  // (or show a clean skeleton until Cloud SQL answers) so demo collections never flash.
  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
  useIsoLayoutEffect(() => {
    const signedInHint = document.documentElement.dataset.auth === 'in';
    if (signedInHint) {
      const cachedCloud = readStoredCollections(CLOUD_EVENTS_CACHE_KEY);
      if (cachedCloud !== null) {
        setCollections(cachedCloud);
        setActiveId((prev) => prev || cachedCloud[0]?.id || '');
        setHydrated(true);
      }
      return;
    }
    const local = readStoredCollections(LOCAL_EVENTS_STORAGE_KEY);
    const initial = local && local.length > 0 ? local : [createCollectionFromBlueprint('marriage')];
    setCollections(initial);
    setActiveId((prev) => prev || initial[0]?.id || '');
    setHydrated(true);
  }, []);

  // Sync with Cloud SQL once signed-in user resolves
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const init = async () => {
      if (!user) {
        if (!cancelled) {
          const local = readStoredCollections(LOCAL_EVENTS_STORAGE_KEY);
          const fallback = local && local.length > 0 ? local : [createCollectionFromBlueprint('marriage')];
          setCollections((prev) => (prev.length > 0 ? prev : fallback));
          setActiveId((prev) => prev || fallback[0]?.id || '');
          setSyncState('local');
          setHydrated(true);
        }
        return;
      }

      const token = await getFreshToken();
      if (!token || cancelled) {
        if (!cancelled) setHydrated(true);
        return;
      }
      try {
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Load failed');
        const data = (await res.json()) as { collections?: EventCollection[] };
        if (cancelled) return;

        const cleaned = Array.isArray(data.collections)
          ? data.collections.map((c) => cleanLegacyPhantomGuests(c))
          : [];

        setCollections(cleaned);
        setActiveId((prev) =>
          prev && cleaned.some((c) => c.id === prev) ? prev : cleaned[0]?.id || '',
        );
        writeStoredCollections(CLOUD_EVENTS_CACHE_KEY, cleaned);
        writeStoredCollections(LOCAL_EVENTS_STORAGE_KEY, cleaned);
        setSyncState('synced');
      } catch {
        if (!cancelled) {
          const cached =
            readStoredCollections(CLOUD_EVENTS_CACHE_KEY) ??
            readStoredCollections(LOCAL_EVENTS_STORAGE_KEY) ??
            [];
          setCollections(cached);
          setActiveId((prev) => prev || cached[0]?.id || '');
          setSyncState('error');
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, getFreshToken]);

  const active = useMemo(
    () => collections.find((c) => c.id === activeId) ?? collections[0],
    [collections, activeId],
  );

  // Keep a ref to the active collection so mutation callbacks stay referentially stable
  // and never invalidate React.memo on unaffected VendorCard / SubEventCard rows.
  const activeRef = useRef<EventCollection | undefined>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const persistCollection = useCallback(
    async (nextCollection: EventCollection, allCollections: EventCollection[]) => {
      writeStoredCollections(LOCAL_EVENTS_STORAGE_KEY, allCollections);
      if (user) {
        writeStoredCollections(CLOUD_EVENTS_CACHE_KEY, allCollections);
      }
      if (!user) {
        setSyncState('local');
        return;
      }
      setSyncState('saving');
      try {
        const token = await getFreshToken();
        if (!token) {
          setSyncState('local');
          return;
        }
        const res = await fetch(`/api/events/${encodeURIComponent(nextCollection.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(nextCollection),
        });
        if (!res.ok) throw new Error('Save failed');
        setSyncState('synced');
      } catch {
        setSyncState('error');
        toast.error('Saved locally — could not sync to cloud right now.');
      }
    },
    [user, getFreshToken],
  );

  const updateActive = useCallback(
    (updater: (prev: EventCollection) => EventCollection) => {
      const targetId = activeRef.current?.id;
      if (!targetId) return;
      setCollections((prevAll) => {
        const current = prevAll.find((c) => c.id === targetId);
        if (!current) return prevAll;
        const updated = updater(current);
        const nextAll = prevAll.map((c) => (c.id === targetId ? updated : c));
        queueMicrotask(() => {
          void persistCollection(updated, nextAll);
        });
        return nextAll;
      });
    },
    [persistCollection],
  );

  const createNewFromBlueprint = (kind: CollectionKind) => {
    const fresh = createCollectionFromBlueprint(kind);
    const nextAll = [fresh, ...collections];
    setCollections(nextAll);
    setActiveId(fresh.id);
    setSelectedSubId('all');
    setShowBlueprintPicker(false);
    void persistCollection(fresh, nextAll);
    toast.success(`Created "${fresh.title}" with ${fresh.subEvents.length} customizable ${fresh.subEvents.length === 1 ? 'sub-event' : 'sub-events'}.`);
  };

  const deleteActiveCollection = async () => {
    if (!active) return;
    if (!user && collections.length <= 1) {
      toast.info('Keep at least one event collection, or create a new one first.');
      return;
    }
    const remaining = collections.filter((c) => c.id !== active.id);
    setCollections(remaining);
    setActiveId(remaining[0]?.id || '');
    writeStoredCollections(LOCAL_EVENTS_STORAGE_KEY, remaining);
    if (user) {
      writeStoredCollections(CLOUD_EVENTS_CACHE_KEY, remaining);
      const token = await getFreshToken();
      if (token) {
        await fetch(`/api/events/${encodeURIComponent(active.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }
    toast('Removed event collection.');
  };

  const addSubEvent = () => {
    if (!active || !newSubTitle.trim()) {
      toast.error('Enter a sub-event name (e.g. Sangeet, Cocktail, Brunch).');
      return;
    }
    const sub: SubEvent = {
      id: makeId('sub'),
      collectionId: active.id,
      sortOrder: active.subEvents.length,
      title: newSubTitle.trim(),
      eventDate: newSubDate,
      timeSlot: newSubTime.trim(),
      venueName: newSubVenue.trim(),
      venueAddress: active.city,
      guestCount: Math.max(0, Number(newSubGuests) || 0),
      coordinatorName: newSubCoord.trim(),
      coordinatorPhone: newSubCoordPhone.trim(),
      status: 'planning',
      notes: '',
    };
    updateActive((prev) => ({ ...prev, subEvents: [...prev.subEvents, sub] }));
    setSelectedSubId(sub.id);
    setNewSubTitle('');
    setNewSubDate('');
    setNewSubTime('');
    setNewSubVenue('');
    setNewSubGuests('');
    setNewSubCoord('');
    setNewSubCoordPhone('');
    setShowAddSub(false);
    toast.success(`Added sub-event "${sub.title}".`);
  };

  const updateSubEvent = useCallback(
    (subId: string, patch: Partial<SubEvent>) => {
      updateActive((prev) => ({
        ...prev,
        subEvents: prev.subEvents.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
      }));
    },
    [updateActive],
  );

  const removeSubEvent = useCallback(
    (subId: string) => {
      updateActive((prev) => ({
        ...prev,
        subEvents: prev.subEvents.filter((s) => s.id !== subId),
        vendors: prev.vendors.map((v) => (v.subEventId === subId ? { ...v, subEventId: null } : v)),
      }));
      setSelectedSubId((prev) => (prev === subId ? 'all' : prev));
      toast('Sub-event removed; its vendors were kept under All sub-events.');
    },
    [updateActive],
  );

  const addVendor = () => {
    if (!active || !newVendorName.trim()) {
      toast.error('Enter the vendor or contact business name.');
      return;
    }
    const vendor: EventVendor = {
      id: makeId('vnd'),
      collectionId: active.id,
      subEventId:
        newVendorSubId && newVendorSubId !== 'all'
          ? newVendorSubId
          : selectedSubId !== 'all'
            ? selectedSubId
            : null,
      category: newVendorCategory,
      vendorName: newVendorName.trim(),
      contactPerson: newVendorPerson.trim(),
      contactPhone: newVendorPhone.trim(),
      contactEmail: newVendorEmail.trim(),
      whatsappNumber: newVendorPhone.trim(),
      agreedFee: Math.max(0, Math.round(Number(newVendorFee) || 0)),
      advancePaid: Math.max(0, Math.round(Number(newVendorAdvance) || 0)),
      paymentDueDate: '',
      utrReference: newVendorUtr.trim(),
      agreementStatus: 'draft',
      clauseSummary: newVendorTerms.trim(),
      deliverables: '',
    };
    updateActive((prev) => ({ ...prev, vendors: [vendor, ...prev.vendors] }));
    setNewVendorName('');
    setNewVendorPerson('');
    setNewVendorPhone('');
    setNewVendorEmail('');
    setNewVendorFee('');
    setNewVendorAdvance('');
    setNewVendorUtr('');
    setNewVendorTerms('');
    setShowAddVendor(false);
    toast.success(`Added ${vendor.vendorName} to ${active.title}.`);
  };

  const updateVendor = useCallback(
    (vendorId: string, patch: Partial<EventVendor>) => {
      updateActive((prev) => ({
        ...prev,
        vendors: prev.vendors.map((v) => (v.id === vendorId ? { ...v, ...patch } : v)),
      }));
    },
    [updateActive],
  );

  const removeVendor = useCallback(
    (vendorId: string) => {
      updateActive((prev) => ({
        ...prev,
        vendors: prev.vendors.filter((v) => v.id !== vendorId),
      }));
      toast('Vendor removed.');
    },
    [updateActive],
  );

  const handleSelectSub = useCallback((subId: string) => {
    setSelectedSubId(subId);
  }, []);

  const handleToggleEditSub = useCallback((subId: string) => {
    setEditingSubId((prev) => (prev === subId ? null : subId));
  }, []);

  const handleToggleEditVendor = useCallback((vendorId: string) => {
    setEditingVendorId((prev) => (prev === vendorId ? null : vendorId));
  }, []);

  const openVendorInEditor = useCallback(
    (vendor: EventVendor) => {
      const current = activeRef.current;
      if (!current) return;
      const scope = buildScopeFromEventVendor(current, vendor);
      try {
        window.sessionStorage.setItem(GUIDED_STASH_KEY, JSON.stringify(scope));
      } catch {
        /* ignore */
      }
      router.push('/?guided=1');
    },
    [router],
  );

  const copyWhatsAppConfirm = useCallback(
    async (vendor: EventVendor) => {
      const current = activeRef.current;
      if (!current) return;
      const { message } = buildVendorWhatsAppConfirm(current, vendor);
      try {
        await navigator.clipboard.writeText(message);
        if (vendor.agreementStatus === 'draft') {
          updateVendor(vendor.id, { agreementStatus: 'whatsapp-sent' });
        }
        toast.success('Copied WhatsApp confirmation text — paste directly in your vendor chat.');
      } catch {
        toast.error('Could not access clipboard. Use the Open WhatsApp link instead.');
      }
    },
    [updateVendor],
  );

  const askAdvisorAboutCollection = (prompt?: string) => {
    if (!active) return;
    openAdvisorDrawer({
      persona: active.kind === 'apartment-move' ? 'rights-shield' : 'wedding-planner',
      collectionId: active.id,
      contextSummary: summarizeCollectionForAI(active),
      prompt,
    });
  };

  const totals = useMemo(() => (active ? computeCollectionTotals(active) : null), [active]);

  const subEvents = active?.subEvents;
  const vendors = active?.vendors;

  const subEventById = useMemo(() => {
    const map = new Map<string, SubEvent>();
    if (!subEvents) return map;
    for (let i = 0; i < subEvents.length; i += 1) {
      map.set(subEvents[i].id, subEvents[i]);
    }
    return map;
  }, [subEvents]);

  const subEventTitleMap = useMemo(
    () => (subEvents ? buildSubEventTitleMap(subEvents) : new Map<string, string>()),
    [subEvents],
  );

  const vendorCountBySubEvent = useMemo(
    () =>
      subEvents && vendors
        ? buildVendorCountBySubEvent(subEvents, vendors)
        : new Map<string, number>(),
    [subEvents, vendors],
  );

  const activeIdMeta = active?.id ?? '';
  const activeTitleMeta = active?.title ?? '';
  const activeCityMeta = active?.city ?? '';
  const activeCurrencyMeta = active?.currency ?? 'INR';
  const activeJurisdictionMeta = active?.jurisdiction ?? 'in-ka';
  const activePrimaryNameMeta = active?.primaryContactName ?? '';
  const activePrimaryPhoneMeta = active?.primaryContactPhone ?? '';
  const activeKindMeta = active?.kind ?? 'custom';
  const activeStartDateMeta = active?.startDate ?? '';
  const activeEndDateMeta = active?.endDate ?? '';
  const activeNotesMeta = active?.notes ?? '';

  // Stable collection metadata object: only changes when collection header fields change,
  // NOT when a single vendor's status or advance changes — keeping sibling VendorCards memoized.
  const collectionMeta = useMemo(
    () => ({
      id: activeIdMeta,
      title: activeTitleMeta,
      city: activeCityMeta,
      currency: activeCurrencyMeta,
      jurisdiction: activeJurisdictionMeta,
      primaryContactName: activePrimaryNameMeta,
      primaryContactPhone: activePrimaryPhoneMeta,
      kind: activeKindMeta,
      startDate: activeStartDateMeta,
      endDate: activeEndDateMeta,
      notes: activeNotesMeta,
    }),
    [
      activeIdMeta,
      activeTitleMeta,
      activeCityMeta,
      activeCurrencyMeta,
      activeJurisdictionMeta,
      activePrimaryNameMeta,
      activePrimaryPhoneMeta,
      activeKindMeta,
      activeStartDateMeta,
      activeEndDateMeta,
      activeNotesMeta,
    ],
  );

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredSubEvents = useMemo(() => {
    if (!subEvents) return [];
    return filterCollectionSubEvents(subEvents, subStatusFilter, deferredSearchQuery);
  }, [subEvents, subStatusFilter, deferredSearchQuery]);

  const effectiveSelectedSubId = useMemo(() => {
    if (selectedSubId === 'all') return 'all';
    return filteredSubEvents.some((s) => s.id === selectedSubId) ? selectedSubId : 'all';
  }, [selectedSubId, filteredSubEvents]);

  const filteredVendors = useMemo(() => {
    if (!vendors) return [];
    return filterCollectionVendors(
      vendors,
      subEventTitleMap,
      effectiveSelectedSubId,
      deferredSearchQuery,
    );
  }, [vendors, subEventTitleMap, effectiveSelectedSubId, deferredSearchQuery]);

  const subEventStatusCounts = useMemo(
    () => buildSubEventStatusCounts(filteredSubEvents),
    [filteredSubEvents],
  );

  const subEventBudgetData = useMemo(
    () => buildSubEventBudgetComparison(filteredSubEvents, vendors ?? []),
    [filteredSubEvents, vendors],
  );

  const hasActiveFilter = Boolean(searchQuery.trim()) || subStatusFilter !== 'all';

  const downloadSubEventsCsv = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    if (filteredSubEvents.length === 0) {
      toast.info('No sub-events match the current filter to export.');
      return;
    }
    const csv = buildSubEventsCsv(current, filteredSubEvents);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildSubEventsCsvFilename(current.title);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(
      `Downloaded ${filteredSubEvents.length} ${filteredSubEvents.length === 1 ? 'sub-event' : 'sub-events'} as CSV.`,
    );
  }, [filteredSubEvents]);

  if (!hydrated) {
    return (
      <div className="events-page">
        <div className="events-top-bar">
          <div>
            <p className="eyebrow">EVENT &amp; WEDDING COLLECTIONS HUB</p>
            <h1>
              One hub for <em>every sub-event</em> &amp; vendor lock.
            </h1>
          </div>
        </div>
        <Skeleton cards={2} lines={3} label="Loading your event collections…" />
      </div>
    );
  }

  if (!active || !totals) {
    return (
      <div className="events-page">
        <div className="events-top-bar">
          <div>
            <p className="eyebrow">EVENT &amp; WEDDING COLLECTIONS HUB</p>
            <h1>
              One hub for <em>every sub-event</em> &amp; vendor lock.
            </h1>
            <p className="quiet">
              1. Pick a blueprint or start blank → 2. Add vendors &amp; advances → 3. Lock each vendor via WhatsApp or Full Agreement.
            </p>
          </div>
        </div>
        <section className="events-blueprint-panel" aria-label="Start your first event collection">
          <div className="events-panel-head">
            <div>
              <p className="eyebrow flush">START YOUR FIRST COLLECTION</p>
              <h2>Pick a prefilled chain or start blank</h2>
            </div>
          </div>
          <div className="events-blueprint-grid">
            {COLLECTION_BLUEPRINTS.map((bp) => (
              <button
                key={bp.kind}
                type="button"
                className="events-blueprint-card"
                onClick={() => createNewFromBlueprint(bp.kind)}
              >
                <span className="eyebrow flush">{bp.badge}</span>
                <strong>{bp.name}</strong>
                <p className="fine">{bp.description}</p>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="events-page">
      <header className="events-top-bar">
        <div className="events-top-head">
          <div>
            <p className="eyebrow">EVENT &amp; WEDDING COLLECTIONS HUB</p>
            <h1>
              One hub for <em>every sub-event</em> &amp; vendor lock.
            </h1>
            <p className="quiet">
              Keep an entire wedding chain or renovation linked — every sub-event, contact phone, advance paid, and WhatsApp lock in one workspace.
            </p>
            <p className="fine flush">
              <strong>How it works:</strong> 1. Add sub-events → 2. Add vendors &amp; advances → 3. Lock each vendor via WhatsApp Confirm or Full Agreement.
            </p>
          </div>

          <div className="events-top-actions">
            <button
              type="button"
              className="primary"
              onClick={() => setShowBlueprintPicker((v) => !v)}
            >
              <Plus size={16} aria-hidden="true" />
              <span>New Main Event</span>
            </button>
          </div>
        </div>

        {/* Header Search & Status Filter */}
        <div className="events-header-search-row" role="search" aria-label="Search sub-events by name or status">
          <div className="events-search-wrap events-top-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search sub-events by name or status"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sub-events by name or status (e.g. Haldi, planning, confirmed, completed)…"
            />
            {searchQuery && (
              <button
                type="button"
                className="events-search-clear"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              type="button"
              aria-label="Filter sub-events by status"
              className="events-filter-trigger"
            >
              <span>
                {SUB_STATUS_FILTER_OPTIONS.find((o) => o.value === subStatusFilter)?.label ??
                  'All sub-events'}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="events-status-menu">
              {SUB_STATUS_FILTER_OPTIONS.map((opt) => {
                const isSelected = subStatusFilter === opt.value;
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    className={`events-status-option${isSelected ? ' is-selected' : ''}`}
                    onSelect={() => setSubStatusFilter(opt.value)}
                  >
                    <div className="events-status-option-copy">
                      <span className="events-status-option-label">{opt.label}</span>
                      <span className="events-status-option-hint">{opt.hint}</span>
                    </div>
                    {isSelected && <Check size={14} aria-hidden="true" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasActiveFilter && (
            <div className="events-filter-summary" role="status">
              <span>
                {filteredSubEvents.length} {filteredSubEvents.length === 1 ? 'sub-event' : 'sub-events'} ·{' '}
                {filteredVendors.length} {filteredVendors.length === 1 ? 'vendor' : 'vendors'}
              </span>
              <button
                type="button"
                className="help-link"
                onClick={() => {
                  setSearchQuery('');
                  setSubStatusFilter('all');
                  setSelectedSubId('all');
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Sync / Auth persistence banner */}
      <div className="events-sync-strip">
        <div className="events-collection-pills" role="tablist" aria-label="Your event collections">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === active.id}
              className={`events-col-tab${c.id === active.id ? ' is-active' : ''}`}
              onClick={() => {
                setActiveId(c.id);
                setSelectedSubId('all');
              }}
            >
              <span>{c.title}</span>
              <span className="events-col-count">{c.subEvents.length}</span>
            </button>
          ))}
        </div>

        <div className="events-sync-meta">
          {user ? (
            <span className="events-sync-badge is-cloud">
              <Cloud size={14} aria-hidden="true" />
              {syncState === 'saving'
                ? 'Saving to cloud…'
                : syncState === 'error'
                  ? 'Saved locally (retry on edit)'
                  : `Synced as ${user.email}`}
            </span>
          ) : (
            <span className="events-sync-badge">
              <HardDrive size={14} aria-hidden="true" />
              <span>{hydrated ? 'Saved in this browser' : 'Ready'} ·</span>
              <Link className="help-link" href="/auth/sign-in?return_to=%2Fevents">
                Sign in with Google to sync
              </Link>
            </span>
          )}
        </div>
      </div>

      {/* Blueprint Picker Drawer */}
      {showBlueprintPicker && (
        <section className="events-blueprint-panel" aria-label="Choose an event collection blueprint">
          <div className="events-panel-head">
            <div>
              <p className="eyebrow flush">START FROM A MULTI-EVENT BLUEPRINT</p>
              <h2>Pick a prefilled chain — then customize any sub-event</h2>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowBlueprintPicker(false)}
            >
              Close
            </button>
          </div>
          <div className="events-blueprint-grid">
            {COLLECTION_BLUEPRINTS.map((bp) => (
              <button
                key={bp.kind}
                type="button"
                className="events-blueprint-card"
                onClick={() => createNewFromBlueprint(bp.kind)}
              >
                <span className="eyebrow flush">{bp.badge}</span>
                <strong>{bp.name}</strong>
                <p className="fine">{bp.description}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Compact Main Event Summary Bar + Collapsible 3x2 Details Drawer */}
      <section className="events-summary-card" aria-label="Main event details">
        <div className="events-summary-bar">
          <div className="events-summary-info">
            <p className="eyebrow flush">MAIN EVENT</p>
            <h2>{active.title}</h2>
            <p className="events-summary-meta">
              {[
                active.city || 'City not set',
                `${JURISDICTIONS.find((j) => j.id === active.jurisdiction)?.label ?? active.jurisdiction} (${active.currency})`,
                active.primaryContactName
                  ? `Host: ${active.primaryContactName}${active.primaryContactPhone ? ` (${active.primaryContactPhone})` : ''}`
                  : null,
                active.startDate ? `Starts ${active.startDate}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="events-summary-actions">
            <button
              type="button"
              className="help-link"
              onClick={() =>
                askAdvisorAboutCollection(
                  'Review my active event collection, flag unprotected vendors, and draft a WhatsApp confirmation for the highest-value draft vendor.',
                )
              }
            >
              Review with AI
            </button>
            <button
              type="button"
              className="secondary events-compact-btn"
              aria-expanded={showEventDetails}
              onClick={() => setShowEventDetails((v) => !v)}
            >
              {showEventDetails ? 'Done editing' : 'Edit event details'}
            </button>
          </div>
        </div>

        {showEventDetails && (
          <div className="events-header-edit">
            <div className="events-header-grid">
              <label>
                Main Event Name
                <input
                  value={active.title}
                  onChange={(e) => updateActive((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Eashwaren–Apoorva Wedding or 3BHK Renovation"
                />
              </label>
              <label>
                City / Location
                <input
                  value={active.city}
                  onChange={(e) => updateActive((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="e.g. Bengaluru, Jaipur, Mumbai"
                />
              </label>
              <label>
                Jurisdiction &amp; Currency
                <select
                  value={active.jurisdiction}
                  onChange={(e) => {
                    const nextJ = e.target.value as JurisdictionId;
                    const found = JURISDICTIONS.find((j) => j.id === nextJ);
                    updateActive((prev) => ({
                      ...prev,
                      jurisdiction: nextJ,
                      currency: found?.currency ?? prev.currency,
                    }));
                  }}
                >
                  {JURISDICTIONS.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.label} ({j.currency})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Primary Host / Family Contact
                <input
                  value={active.primaryContactName}
                  onChange={(e) =>
                    updateActive((prev) => ({ ...prev, primaryContactName: e.target.value }))
                  }
                  placeholder="e.g. Arvind Eashwaren"
                />
              </label>
              <label>
                Primary Contact Phone
                <input
                  type="tel"
                  value={active.primaryContactPhone}
                  onChange={(e) =>
                    updateActive((prev) => ({ ...prev, primaryContactPhone: e.target.value }))
                  }
                  placeholder="+91 98450 00000"
                />
              </label>
              <label>
                Start Date
                <input
                  type="date"
                  value={active.startDate}
                  onChange={(e) => updateActive((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </label>
            </div>
            {(collections.length > 1 || Boolean(user)) && (
              <div className="events-header-foot">
                <button
                  type="button"
                  className="secondary events-compact-btn"
                  onClick={() => void deleteActiveCollection()}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span>Delete collection</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Roll-up Protection & Money Metrics */}
      <section className="events-kpi-grid" aria-label="Event totals summary">
        <div className="events-kpi">
          <span className="events-kpi-label">Total Agreed Budget</span>
          <strong>{formatMoney(totals.totalBudget, active.currency)}</strong>
          <em>
            {totals.subEventCount} {totals.subEventCount === 1 ? 'sub-event' : 'sub-events'} · {totals.vendorCount} {totals.vendorCount === 1 ? 'vendor' : 'vendors'}
          </em>
        </div>
        <div className="events-kpi">
          <span className="events-kpi-label">Advance Paid</span>
          <strong>{formatMoney(totals.totalAdvancePaid, active.currency)}</strong>
          <em>{formatMoney(totals.totalBalanceDue, active.currency)} balance due</em>
        </div>
        <div className="events-kpi">
          <span className="events-kpi-label">Terms Protected</span>
          <strong className={totals.vendorCount === 0 ? undefined : totals.unprotectedCount === 0 ? 'is-ok' : 'is-warn'}>
            {totals.confirmedCount} / {totals.vendorCount} locked
          </strong>
          <em>
            {totals.vendorCount === 0
              ? 'No vendors added yet'
              : totals.unprotectedCount === 0
                ? 'All vendors confirmed'
                : `${totals.unprotectedCount} need written lock`}
          </em>
        </div>
        <div className="events-kpi">
          <span className="events-kpi-label">Peak Guest Count</span>
          <strong>{totals.totalGuestsPeak > 0 ? totals.totalGuestsPeak : '—'}</strong>
          <em>{totals.totalGuestsPeak > 0 ? 'Peak single event' : 'Optional · set per sub-event'}</em>
        </div>
      </section>

      {/* Main Workspace: Sub-Event Chain + Vendor / Contacts View */}
      <div className="events-workspace">
        {/* Left Column: Customizable Sub-Event Chain */}
        <aside className="events-sub-rail" aria-label="Sub-events timeline">
          <div className="events-rail-head">
            <div>
              <h2>
                Sub-Events (
                {hasActiveFilter
                  ? `${filteredSubEvents.length}/${active.subEvents.length}`
                  : active.subEvents.length}
                )
              </h2>
              <p className="events-rail-sub">Functions or phases inside this main event</p>
            </div>
            <div className="events-rail-actions">
              <button
                type="button"
                className="secondary events-compact-btn"
                onClick={() => setShowAddSub((v) => !v)}
              >
                <CalendarPlus size={14} aria-hidden="true" />
                <span>Add sub-event</span>
              </button>
              <button
                type="button"
                className="secondary events-compact-btn"
                disabled={filteredSubEvents.length === 0}
                title={
                  hasActiveFilter
                    ? 'Export matching sub-events to CSV'
                    : 'Export all sub-events to CSV'
                }
                onClick={downloadSubEventsCsv}
              >
                <Download size={14} aria-hidden="true" />
                <span>Download as CSV</span>
              </button>
            </div>
          </div>

          {showAddSub && (
            <div className="events-inline-form">
              <p className="eyebrow flush">NEW SUB-EVENT</p>
              <label>
                Sub-event name *
                <input
                  value={newSubTitle}
                  onChange={(e) => setNewSubTitle(e.target.value)}
                  placeholder="e.g. Cocktail Night, Griha Pravesh, Brunch"
                />
              </label>
              <div className="two-col">
                <label>
                  Date
                  <input
                    type="date"
                    value={newSubDate}
                    onChange={(e) => setNewSubDate(e.target.value)}
                  />
                </label>
                <label>
                  Guests
                  <input
                    type="number"
                    min={0}
                    placeholder="Optional"
                    value={newSubGuests}
                    onChange={(e) => setNewSubGuests(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Time slot
                <input
                  value={newSubTime}
                  onChange={(e) => setNewSubTime(e.target.value)}
                  placeholder="e.g. 7:00 PM – 11:00 PM"
                />
              </label>
              <label>
                Venue name
                <input
                  value={newSubVenue}
                  onChange={(e) => setNewSubVenue(e.target.value)}
                  placeholder="e.g. Grand Ballroom"
                />
              </label>
              <div className="two-col">
                <label>
                  Coordinator
                  <input
                    value={newSubCoord}
                    onChange={(e) => setNewSubCoord(e.target.value)}
                    placeholder="Contact person"
                  />
                </label>
                <label>
                  Coordinator phone
                  <input
                    type="tel"
                    value={newSubCoordPhone}
                    onChange={(e) => setNewSubCoordPhone(e.target.value)}
                    placeholder="+91 98..."
                  />
                </label>
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={addSubEvent}>
                  Save sub-event
                </button>
                <button type="button" className="secondary" onClick={() => setShowAddSub(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {active.subEvents.length > 1 && (
            <button
              type="button"
              className={`events-sub-item${effectiveSelectedSubId === 'all' ? ' is-selected' : ''}`}
              onClick={() => setSelectedSubId('all')}
            >
              <div className="events-sub-item-top">
                <strong>All sub-events</strong>
                <span className="events-sub-count">{active.vendors.length} vendors</span>
              </div>
              <span className="fine">View the entire event chain</span>
            </button>
          )}

          {filteredSubEvents.length === 0 ? (
            <div className="events-empty-box events-sub-empty">
              <p className="eyebrow flush">NO SUB-EVENTS MATCH</p>
              <p className="fine">
                {subStatusFilter === 'completed'
                  ? 'No sub-events are marked Completed yet. Edit any sub-event to update its status.'
                  : 'Try another search term or switch the status filter.'}
              </p>
              {hasActiveFilter && (
                <button
                  type="button"
                  className="secondary events-compact-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setSubStatusFilter('all');
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <SubEventList
              subEvents={filteredSubEvents}
              vendorCountBySubEvent={vendorCountBySubEvent}
              selectedSubId={effectiveSelectedSubId}
              editingSubId={editingSubId}
              onSelect={handleSelectSub}
              onToggleEdit={handleToggleEditSub}
              onUpdate={updateSubEvent}
              onRemove={removeSubEvent}
            />
          )}
        </aside>

        {/* Right Column: Vendors, Agreements & Unified Contact Directory */}
        <section className="events-main-col" aria-label="Vendors and contacts">
          <div className="events-main-toolbar">
            <div className="events-view-tabs" role="tablist" aria-label="Hub view">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'vendors'}
                className={`hs-tab${viewMode === 'vendors' ? ' is-active' : ''}`}
                onClick={() => setViewMode('vendors')}
              >
                <span>Vendors &amp; Agreements ({filteredVendors.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'contacts'}
                className={`hs-tab${viewMode === 'contacts' ? ' is-active' : ''}`}
                onClick={() => setViewMode('contacts')}
              >
                <span>Contact &amp; Phone Directory</span>
              </button>
            </div>

            <div className="events-toolbar-right">
              <button
                type="button"
                className="primary events-compact-btn"
                onClick={() => {
                  setNewVendorSubId(effectiveSelectedSubId === 'all' ? '' : effectiveSelectedSubId);
                  setShowAddVendor((v) => !v);
                }}
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>Add vendor</span>
              </button>
            </div>
          </div>

          {showAddVendor && (
            <div className="events-inline-form events-vendor-form">
              <p className="eyebrow flush">ADD VENDOR OR COUNTERPARTY TO {active.title.toUpperCase()}</p>
              <div className="two-col">
                <label>
                  Vendor / Company name *
                  <input
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    placeholder="e.g. Royal Spice Caterers"
                  />
                </label>
                <label>
                  Category
                  <select
                    value={newVendorCategory}
                    onChange={(e) => setNewVendorCategory(e.target.value as VendorCategory)}
                  >
                    {Object.entries(VENDOR_CATEGORY_META).map(([k, meta]) => (
                      <option key={k} value={k}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="two-col">
                <label>
                  Linked sub-event
                  <select
                    value={newVendorSubId}
                    onChange={(e) => setNewVendorSubId(e.target.value)}
                  >
                    <option value="">All sub-events (whole event)</option>
                    {active.subEvents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contact person
                  <input
                    value={newVendorPerson}
                    onChange={(e) => setNewVendorPerson(e.target.value)}
                    placeholder="e.g. Vikram Shetty"
                  />
                </label>
              </div>

              <div className="two-col">
                <label>
                  Phone / WhatsApp number
                  <input
                    type="tel"
                    value={newVendorPhone}
                    onChange={(e) => setNewVendorPhone(e.target.value)}
                    placeholder="+91 98801 44556"
                  />
                </label>
                <label>
                  Email (optional)
                  <input
                    type="email"
                    value={newVendorEmail}
                    onChange={(e) => setNewVendorEmail(e.target.value)}
                    placeholder="vendor@example.com"
                  />
                </label>
              </div>

              <div className="three-col">
                <label>
                  Agreed fee ({active.currency})
                  <input
                    type="number"
                    min={0}
                    value={newVendorFee}
                    onChange={(e) => setNewVendorFee(e.target.value)}
                    placeholder="180000"
                  />
                </label>
                <label>
                  Advance paid ({active.currency})
                  <input
                    type="number"
                    min={0}
                    value={newVendorAdvance}
                    onChange={(e) => setNewVendorAdvance(e.target.value)}
                    placeholder="45000"
                  />
                </label>
                <label>
                  UPI / Bank UTR ref
                  <input
                    value={newVendorUtr}
                    onChange={(e) => setNewVendorUtr(e.target.value)}
                    placeholder="UTR..."
                  />
                </label>
              </div>

              <label>
                Key terms / overage cap / deliverables
                <textarea
                  rows={2}
                  value={newVendorTerms}
                  onChange={(e) => setNewVendorTerms(e.target.value)}
                  placeholder="e.g. 250 plates @ ₹850, +10% buffer at same rate, setup ready by 5 PM"
                />
              </label>

              <div className="actions">
                <button type="button" className="primary" onClick={addVendor}>
                  Save vendor
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowAddVendor(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {viewMode === 'contacts' ? (
            <div className="table-scroll">
              <table className="msme-table">
                <thead>
                  <tr>
                    <th>Role / Vendor</th>
                    <th>Contact Person</th>
                    <th>Phone</th>
                    <th>Sub-Event</th>
                    <th className="num">Balance Due</th>
                    <th>Quick Action</th>
                  </tr>
                </thead>
                <tbody>
                  {active.primaryContactName && (
                    <tr>
                      <td>
                        <strong>Primary Host</strong>
                      </td>
                      <td>{active.primaryContactName}</td>
                      <td>
                        {active.primaryContactPhone ? (
                          <a className="help-link" href={`tel:${sanitizePhoneDigits(active.primaryContactPhone)}`}>
                            {active.primaryContactPhone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>Whole Event</td>
                      <td className="num">—</td>
                      <td>Host Lead</td>
                    </tr>
                  )}
                  {active.subEvents
                    .filter((s) => s.coordinatorName || s.coordinatorPhone)
                    .map((s) => (
                      <tr key={`coord_${s.id}`}>
                        <td>Sub-event Coordinator</td>
                        <td>{s.coordinatorName || '—'}</td>
                        <td>
                          {s.coordinatorPhone ? (
                            <a className="help-link" href={`tel:${sanitizePhoneDigits(s.coordinatorPhone)}`}>
                              {s.coordinatorPhone}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{s.title}</td>
                        <td className="num">—</td>
                        <td>{s.venueName || 'Venue TBD'}</td>
                      </tr>
                    ))}
                  {active.vendors.map((v) => {
                    const sub = active.subEvents.find((s) => s.id === v.subEventId);
                    const bal = Math.max(0, v.agreedFee - v.advancePaid);
                    const { waHref } = buildVendorWhatsAppConfirm(active, v);
                    return (
                      <tr key={v.id}>
                        <td>
                          <strong>{v.vendorName}</strong>
                        </td>
                        <td>{v.contactPerson || '—'}</td>
                        <td>
                          {v.contactPhone ? (
                            <a className="help-link" href={`tel:${sanitizePhoneDigits(v.contactPhone)}`}>
                              {v.contactPhone}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{sub ? sub.title : 'All sub-events'}</td>
                        <td className="num">{formatMoney(bal, active.currency)}</td>
                        <td>
                          <a className="help-link" href={waHref} target="_blank" rel="noreferrer">
                            WhatsApp confirm
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : filteredVendors.length === 0 ? (
            <div className="events-empty-box">
              <p className="eyebrow flush">NO VENDORS MATCH THIS FILTER</p>
              <p className="fine">
                Add a caterer, decorator, photographer, venue, or contractor for this sub-event to track
                their phone number, advance paid, and written confirmation.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => setShowAddVendor(true)}
              >
                <UserPlus size={15} aria-hidden="true" /> Add your first vendor
              </button>
            </div>
          ) : (
            <VendorList
              vendors={filteredVendors}
              collectionMeta={collectionMeta}
              subEventById={subEventById}
              subEvents={active.subEvents}
              editingVendorId={editingVendorId}
              onUpdate={updateVendor}
              onRemove={removeVendor}
              onToggleEdit={handleToggleEditVendor}
              onOpenEditor={openVendorInEditor}
              onCopyConfirm={copyWhatsAppConfirm}
            />
          )}
        </section>
      </div>

      {/* Event Analytics Section (below main workspace): Budget vs Actual Paid + Completion Status */}
      <section className="events-analytics-section" aria-label="Event analytics and status overview">
        <div className="events-analytics-grid">
          <SubEventBudgetChart
            data={subEventBudgetData}
            currency={active.currency}
            totalBudget={totals.totalBudget}
            totalPaid={totals.totalAdvancePaid}
          />
          <SubEventStatusChart
            data={subEventStatusCounts}
            totalCount={active.subEvents.length}
            filteredCount={filteredSubEvents.length}
            isFiltered={hasActiveFilter}
          />
        </div>
      </section>
    </div>
  );
}
