// RBI Bank Rate, dated (percent p.a.). Each row applies from its `from` date until the next row.
// Used by lib/msmed.ts for MSMED Act s.16 interest (3 × the Bank Rate notified by the RBI).
// Data only. Never hard-code a single rate elsewhere; add a row when the RBI changes the Bank Rate
// (it moves with the MSF rate at each MPC decision). Created by WS-03 (plan §9.1 row 2a assigns this
// file to WS-01 as data; WS-01 did not add it, so WS-03 owns it until WS-01 takes it over).
//
// Verified 12 Oct 2026 against the RBI press releases linked in each row, except where marked.

export type BankRateRow = {from: string; rate: number; source: string; verified: boolean};

export const RBI_BANK_RATE: readonly BankRateRow[] = [
  // June 2025 MPC: repo cut 50 bps to 5.50%, MSF/Bank Rate 5.75%. Not re-fetched by WS-03.
  {from: '2025-06-06', rate: 5.75, source: 'https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=60604', verified: false},
  // Governor's Statement, 5 Dec 2025 (PR 2025-2026/1634): repo 5.25%, "the MSF rate and the Bank Rate to 5.50 per cent".
  {from: '2025-12-05', rate: 5.50, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61750', verified: true},
  // MPC resolution, 7 Oct 2026 (PR 2026-2027/1264): repo up 25 bps to 5.50%, "the MSF rate and the Bank Rate at 5.75 per cent".
  {from: '2026-10-07', rate: 5.75, source: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742', verified: true},
];
