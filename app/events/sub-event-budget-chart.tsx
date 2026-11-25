'use client';

import { memo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '@/lib/currency';
import type { SubEventBudgetDatum } from '@/lib/event-list-selectors';

export type SubEventBudgetChartProps = {
  data: readonly SubEventBudgetDatum[];
  currency: string;
  totalBudget: number;
  totalPaid: number;
};

function formatAxisAmount(value: number, currency: string): string {
  const n = Number(value) || 0;
  if (n === 0) return '0';
  if (currency === 'INR') {
    if (n >= 100000) return `${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)}L`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export const SubEventBudgetChart = memo(function SubEventBudgetChart({
  data,
  currency,
  totalBudget,
  totalPaid,
}: SubEventBudgetChartProps) {
  const chartData = data as SubEventBudgetDatum[];
  const hasMoney = chartData.some((d) => d.agreedBudget > 0 || d.actualPaid > 0);
  const paidPct = totalBudget > 0 ? Math.min(100, Math.round((totalPaid / totalBudget) * 100)) : 0;

  return (
    <section className="events-chart-card" aria-label="Budget versus actual paid across sub-events">
      <div className="events-chart-head">
        <div>
          <p className="eyebrow flush">BUDGET VS. ACTUAL PAID</p>
          <h2>Agreed budget vs. advances paid by sub-event</h2>
        </div>
        <span className="events-chart-meta">
          {totalBudget > 0
            ? `${paidPct}% paid (${formatMoney(totalPaid, currency)} of ${formatMoney(totalBudget, currency)})`
            : 'No vendor fees logged yet'}
        </span>
      </div>

      {!hasMoney ? (
        <div className="events-chart-empty" data-testid="sub-event-budget-chart">
          <p className="fine flush">
            Add vendor fees and advances above to compare planned budget against actual paid amounts for each sub-event.
          </p>
        </div>
      ) : (
        <div className="events-chart-canvas" data-testid="sub-event-budget-chart">
          <ResponsiveContainer width="100%" height={220} minWidth={240}>
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 12, left: -4, bottom: 4 }}
              barGap={4}
              barCategoryGap="24%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--rule)" />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: 'var(--rule-strong)' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={10}
                tick={{ fill: 'var(--ink)', fontSize: 11, fontFamily: 'var(--font-ui)' }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v) => formatAxisAmount(Number(v), currency)}
                tick={{ fill: 'var(--ink-2)', fontSize: 11, fontFamily: 'var(--font-ui)' }}
              />
              <Tooltip
                cursor={{ fill: 'var(--accent-soft)' }}
                contentStyle={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: '8px',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: '13px',
                }}
                labelStyle={{ color: 'var(--ink)', fontWeight: 600, marginBottom: '4px' }}
                labelFormatter={(_label, payload) => {
                  const row = payload?.[0]?.payload as SubEventBudgetDatum | undefined;
                  return row ? row.fullTitle : String(_label ?? '');
                }}
                formatter={(value, name) => [
                  formatMoney(Number(value ?? 0), currency),
                  name === 'agreedBudget' ? 'Agreed Budget' : 'Actual Paid',
                ]}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="square"
                iconSize={9}
                wrapperStyle={{ fontSize: '12px', fontFamily: 'var(--font-ui)' }}
                formatter={(val) => (val === 'agreedBudget' ? 'Agreed Budget' : 'Actual Paid')}
              />
              <Bar
                dataKey="agreedBudget"
                name="agreedBudget"
                fill="var(--accent)"
                radius={[5, 5, 0, 0]}
                maxBarSize={32}
                isAnimationActive={true}
                animationDuration={420}
                animationEasing="ease-out"
              />
              <Bar
                dataKey="actualPaid"
                name="actualPaid"
                fill="var(--ok)"
                radius={[5, 5, 0, 0]}
                maxBarSize={32}
                isAnimationActive={true}
                animationDuration={420}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
});
