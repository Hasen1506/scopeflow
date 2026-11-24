'use client';

import { memo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SubEventStatusDatum } from '@/lib/event-list-selectors';

const STATUS_BAR_COLOR: Record<SubEventStatusDatum['status'], string> = {
  planning: 'var(--ink-2)',
  locked: 'var(--warn)',
  confirmed: 'var(--accent)',
  completed: 'var(--ok)',
};

export type SubEventStatusChartProps = {
  data: readonly SubEventStatusDatum[];
  totalCount: number;
  filteredCount: number;
  isFiltered: boolean;
};

export const SubEventStatusChart = memo(function SubEventStatusChart({
  data,
  totalCount,
  filteredCount,
  isFiltered,
}: SubEventStatusChartProps) {
  const chartData = data as SubEventStatusDatum[];

  return (
    <section className="events-chart-card" aria-label="Sub-event completion status breakdown">
      <div className="events-chart-head">
        <div>
          <p className="eyebrow flush">SUB-EVENT COMPLETION STATUS</p>
          <h2>Breakdown across Planning, Locked, Confirmed &amp; Completed</h2>
        </div>
        <span className="events-chart-meta">
          {isFiltered
            ? `Showing ${filteredCount} of ${totalCount} ${totalCount === 1 ? 'sub-event' : 'sub-events'}`
            : `${totalCount} ${totalCount === 1 ? 'sub-event' : 'sub-events'} total`}
        </span>
      </div>

      <div className="events-chart-canvas" data-testid="sub-event-status-chart">
        <ResponsiveContainer width="100%" height={200} minWidth={240}>
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 16, left: -12, bottom: 2 }}
            barCategoryGap="28%"
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--rule)" />
            <XAxis
              dataKey="label"
              axisLine={{ stroke: 'var(--rule-strong)' }}
              tickLine={false}
              tick={{ fill: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-ui)' }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font-ui)' }}
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
              itemStyle={{ color: 'var(--ink)' }}
              labelStyle={{ color: 'var(--ink-2)', fontWeight: 600, marginBottom: '2px' }}
              formatter={(value) => {
                const n = Number(value ?? 0);
                return [`${n} ${n === 1 ? 'sub-event' : 'sub-events'}`, 'Count'];
              }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false}>
              {chartData.map((entry) => (
                <Cell key={entry.status} fill={STATUS_BAR_COLOR[entry.status]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <dl className="events-chart-legend" aria-label="Status counts">
        {chartData.map((item) => (
          <div key={item.status} className="events-chart-stat">
            <dt>
              <span className={`events-chart-dot is-${item.status}`} aria-hidden="true" />
              <span>{item.label}</span>
            </dt>
            <dd>{item.count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
});
