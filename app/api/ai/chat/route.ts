import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyFirebaseRequest } from '@/src/lib/server-auth';
import { appendAdvisorTurn, clearAdvisorMessages, listAdvisorMessages } from '@/src/db/events';

type PersonaId = 'wedding-planner' | 'rights-shield' | 'scope-coach';

const PERSONA_PROMPTS: Record<PersonaId, string> = {
  'wedding-planner': `You are the ContractLock Wedding & Multi-Event Advisor. You help families, couples, and event planners organize Indian and international weddings (Engagement, Mehendi, Haldi, Sangeet, Muhurtham/Pheras, Reception) and multi-vendor events.
Your expertise:
- Breaking big events into clean sub-event timelines, vendor checklists, contact directories, and realistic advance/balance milestones.
- Spotting hidden wedding vendor traps: extra-plate markups, unapproved overtime fees, generator/corkage surcharges, vague decor moodboards, and 100% non-refundable advance demands.
- Drafting warm, polite, firm WhatsApp confirmation messages that real Indian caterers, decorators, photographers, and venues will actually reply "Confirmed" to.
Keep answers concise, scannable (short bullets or ready-to-copy message blocks), practical, and free of legal jargon. Never invent fake laws; remind users this is practical guidance, not formal legal advice.`,

  'rights-shield': `You are the ContractLock Clause & Deposit Shield Advisor. You help tenants, homeowners, wedding hosts, and freelancers spot unfair or predatory clauses BEFORE paying an advance.
Your expertise:
- Indian tenancy & contract realities (Model Tenancy Act principles, security deposit caps, normal wear & tear vs actual itemized damage bills, Bharatiya Sakshya Adhiniyam s.63 electronic evidence, Indian Contract Act s.74 reasonable compensation, MSMED Act 45-day payment protection).
- US tenancy rules (California AB 12 1-month cap / 21-day return, New York 14-day itemized forfeiture rule, Texas 30-day rule).
- Writing calm, non-confrontational counter-wording and 3-level escalation steps (WhatsApp soft confirm -> polite written summary -> timestamped evidence record) when a landlord or vendor refuses to sign a formal contract.
Keep answers structured, actionable, and concise. Include a brief note that this is general educational guidance, not formal legal representation.`,

  'scope-coach': `You are the ContractLock Scope & Negotiation Coach. You help freelancers, agencies, interior contractors, and clients turn rough verbal agreements into clear deliverables, revision limits, exclusions, and change-order pricing.
Your expertise:
- Turning vague requests ("unlimited revisions", "full setup", "etc.") into measurable acceptance criteria and milestone schedules.
- Drafting polite change-order messages when clients or hosts ask for extra scope mid-project.
- Structuring fair deposit + milestone splits so both sides stay protected.
Keep responses crisp, well-structured, and immediately usable.`,
};

const chatBodySchema = z.object({
  message: z.string().trim().min(1, 'Enter a message to send.').max(4000),
  persona: z.enum(['wedding-planner', 'rights-shield', 'scope-coach']).optional().default('wedding-planner'),
  speed: z.enum(['balanced', 'fast']).optional().default('balanced'),
  collectionId: z.string().max(64).nullable().optional().default(null),
  contextSummary: z.string().max(4000).optional().default(''),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(24)
    .optional()
    .default([]),
});

function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function GET(req: NextRequest) {
  const user = await verifyFirebaseRequest(req, { syncUser: false });
  if (!user) {
    return NextResponse.json({ messages: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const rows = await listAdvisorMessages(user.uid, 40);
    return NextResponse.json(
      {
        messages: rows.map((r) => ({
          id: String(r.id),
          role: r.role === 'assistant' ? 'assistant' : 'user',
          content: r.content,
          persona: r.persona,
          model: r.model,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('GET /api/ai/chat failed:', error);
    return NextResponse.json({ error: 'Could not load conversation history.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await verifyFirebaseRequest(req, { syncUser: false });
  if (!user) {
    return NextResponse.json({ cleared: true });
  }
  try {
    await clearAdvisorMessages(user.uid);
    return NextResponse.json({ cleared: true });
  } catch (error) {
    console.error('DELETE /api/ai/chat failed:', error);
    return NextResponse.json({ error: 'Could not clear conversation history.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ai = createGeminiClient();
  if (!ai) {
    return NextResponse.json(
      {
        error:
          'Gemini API key is not configured on the server yet. Add GEMINI_API_KEY in Settings → Secrets to enable live AI replies.',
      },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid chat request.' },
      { status: 400 },
    );
  }

  const { message, persona, speed, collectionId, contextSummary, history } = parsed.data;
  const model = speed === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

  const systemInstruction = contextSummary
    ? `${PERSONA_PROMPTS[persona]}\n\nHere is the user's current live ContractLock event collection context — reference exact sub-events, vendor names, phone numbers, fees, and balances when helpful:\n${contextSummary}`
    : PERSONA_PROMPTS[persona];

  try {
    const chat = ai.chats.create({
      model,
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction,
      },
    });

    const response = await chat.sendMessage({ message });
    const reply = (response.text ?? '').trim();
    if (!reply) {
      return NextResponse.json(
        { error: 'The advisor returned an empty reply. Please rephrase and try again.' },
        { status: 502 },
      );
    }

    const user = await verifyFirebaseRequest(req);
    if (user) {
      await appendAdvisorTurn(user.uid, message, reply, {
        persona,
        model,
        collectionId,
      }).catch((err) => console.error('Non-fatal advisor persistence error:', err));
    }

    return NextResponse.json(
      { reply, model, persona, persisted: Boolean(user) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('POST /api/ai/chat Gemini error:', error);
    const msg = error instanceof Error ? error.message : 'Unexpected Gemini API error.';
    const status = /429|RESOURCE_EXHAUSTED/i.test(msg)
      ? 429
      : /403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)
        ? 403
        : 502;
    return NextResponse.json(
      {
        error:
          status === 429
            ? 'Gemini rate limit reached. Wait a moment or switch to Fast mode and try again.'
            : status === 403
              ? 'Gemini API key permission issue. Check your key in Settings → Secrets.'
              : 'Could not reach the Gemini advisor right now. Please try again.',
      },
      { status },
    );
  }
}
