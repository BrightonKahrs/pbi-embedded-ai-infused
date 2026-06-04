import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { VisualConfig, InlineVisual } from '../services/api';
import './InlineChart.css';

interface InlineChartProps {
  visual: InlineVisual;
  onAddToPage?: (visual: InlineVisual) => void;
}

// Palette tuned to the app's purple/indigo theme.
const PALETTE = [
  '#667eea',
  '#764ba2',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#a855f7',
  '#f97316',
];

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatNumber(value: any, hint: 'currency' | 'plain' = 'plain'): string {
  if (typeof value !== 'number' || !isFinite(value)) return String(value ?? '');
  if (hint === 'currency') return CURRENCY_FORMATTER.format(value);
  return COMPACT_NUMBER_FORMATTER.format(value);
}

/**
 * Pick a sensible (categoryKey, valueKey) pair from the raw row keys.
 * Power BI executeQueries returns column keys shaped like `Table[Column]`
 * for columns and `[Measure]` for measures, so:
 * - prefer the first measure-shaped key (`[…]` only) for the value axis
 * - prefer the first non-measure key for the category axis
 */
function detectKeys(rows: Array<Record<string, any>>): { categoryKey: string; valueKey: string } | null {
  if (!rows.length) return null;
  const sample = rows[0];
  const keys = Object.keys(sample);
  if (keys.length < 2) return null;

  const measureKey = keys.find(k => /^\[.+\]$/.test(k) && typeof sample[k] === 'number');
  const numericKey =
    measureKey ??
    keys.find(k => typeof sample[k] === 'number');
  if (!numericKey) return null;

  const categoryKey = keys.find(k => k !== numericKey) ?? keys[0];
  return { categoryKey, valueKey: numericKey };
}

function prettyLabel(rawKey: string): string {
  // `Category[Category]` → `Category`, `[Total Sales]` → `Total Sales`
  const measureMatch = rawKey.match(/^\[(.+)\]$/);
  if (measureMatch) return measureMatch[1];
  const colMatch = rawKey.match(/^.+\[(.+)\]$/);
  if (colMatch) return colMatch[1];
  return rawKey;
}

const InlineChart: React.FC<InlineChartProps> = ({ visual, onAddToPage }) => {
  const { config, data } = visual;

  const { chartData, categoryKey, valueKey, valueLabel, categoryLabel } = useMemo(() => {
    const keys = detectKeys(data);
    if (!keys) {
      return {
        chartData: [],
        categoryKey: '',
        valueKey: '',
        valueLabel: '',
        categoryLabel: '',
      };
    }
    const mapped = data.map(row => ({
      __category: String(row[keys.categoryKey] ?? ''),
      __value: Number(row[keys.valueKey] ?? 0),
    }));
    return {
      chartData: mapped,
      categoryKey: keys.categoryKey,
      valueKey: keys.valueKey,
      valueLabel: prettyLabel(keys.valueKey),
      categoryLabel: prettyLabel(keys.categoryKey),
    };
  }, [data]);

  if (!chartData.length || !categoryKey) {
    return null;
  }

  const looksLikeCurrency = /sales|revenue|profit|amount|total|price/i.test(valueLabel);
  const valueFormatter = (v: any) => formatNumber(v, looksLikeCurrency ? 'currency' : 'plain');

  const renderChart = (visualType: VisualConfig['visualType']) => {
    const commonAxisProps = {
      tick: { fill: '#64748b', fontSize: 11 },
      axisLine: { stroke: '#cbd5e1' },
      tickLine: { stroke: '#cbd5e1' },
    };
    const tooltipStyle = {
      contentStyle: {
        background: 'white',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: 12,
      },
      labelStyle: { color: '#475569', fontWeight: 600 },
      formatter: (v: any) => [valueFormatter(v), valueLabel],
    } as const;

    switch (visualType) {
      case 'lineChart':
        return (
          <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="__category" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={v => formatNumber(v, looksLikeCurrency ? 'currency' : 'plain')} width={48} />
            <Tooltip {...tooltipStyle} />
            <Line
              type="monotone"
              dataKey="__value"
              stroke={PALETTE[0]}
              strokeWidth={2.5}
              dot={{ fill: PALETTE[0], r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        );
      case 'areaChart':
        return (
          <AreaChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="inlineAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.45} />
                <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="__category" {...commonAxisProps} />
            <YAxis {...commonAxisProps} tickFormatter={v => formatNumber(v, looksLikeCurrency ? 'currency' : 'plain')} width={48} />
            <Tooltip {...tooltipStyle} />
            <Area type="monotone" dataKey="__value" stroke={PALETTE[0]} fill="url(#inlineAreaFill)" strokeWidth={2} />
          </AreaChart>
        );
      case 'barChart':
        return (
          <BarChart data={chartData} layout="vertical" margin={{ top: 6, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" {...commonAxisProps} tickFormatter={v => formatNumber(v, looksLikeCurrency ? 'currency' : 'plain')} />
            <YAxis type="category" dataKey="__category" {...commonAxisProps} width={84} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="__value" fill={PALETTE[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        );
      case 'pieChart':
      case 'donutChart': {
        const donut = visualType === 'donutChart';
        return (
          <PieChart>
            <Tooltip
              {...tooltipStyle}
              formatter={(v: any, _n: any, p: any) => [valueFormatter(v), p?.payload?.__category ?? '']}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Pie
              data={chartData}
              dataKey="__value"
              nameKey="__category"
              cx="50%"
              cy="50%"
              outerRadius={75}
              innerRadius={donut ? 40 : 0}
              paddingAngle={donut ? 2 : 0}
              stroke="#fff"
              strokeWidth={2}
            >
              {chartData.map((_entry, idx) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      }
      case 'columnChart':
      default:
        return (
          <BarChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="__category" {...commonAxisProps} interval={0} />
            <YAxis {...commonAxisProps} tickFormatter={v => formatNumber(v, looksLikeCurrency ? 'currency' : 'plain')} width={48} />
            <Tooltip {...tooltipStyle} />
            <Bar dataKey="__value" radius={[6, 6, 0, 0]}>
              {chartData.map((_entry, idx) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        );
    }
  };

  return (
    <div className="inline-chart" role="figure" aria-label={config.title}>
      <div className="inline-chart-header">
        <div className="inline-chart-title" title={config.title}>
          {config.title}
        </div>
        {onAddToPage && (
          <button
            type="button"
            className="inline-chart-add-button"
            onClick={() => onAddToPage(visual)}
            title="Add this visual to your Power BI report"
          >
            ＋ Add to page
          </button>
        )}
      </div>
      <div className="inline-chart-body" aria-hidden={false}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(config.visualType)}
        </ResponsiveContainer>
      </div>
      <div className="inline-chart-footer">
        <span className="inline-chart-meta">
          {chartData.length} {chartData.length === 1 ? 'row' : 'rows'} · {categoryLabel} ↔ {valueLabel}
        </span>
      </div>
    </div>
  );
};

export default InlineChart;
