import React, { useEffect, useRef, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models, Report } from 'powerbi-client';
import 'powerbi-report-authoring';
import { apiService, VisualConfig, InlineVisual } from '../services/api';
import { createInlineVisualOnly } from '../services/inlineVisualPinner';
import InlineChart from './InlineChart';
import './InlineChart.css';

interface InlinePowerBIVisualProps {
  config: VisualConfig;
  /** The user's loaded report. Must be in Edit mode with Permissions.All for
   *  authoring; if null or non-authoring, falls back to Recharts. */
  report: Report | null;
  /** Fallback visual (with raw data rows) used if Power BI embedding fails. */
  fallbackVisual: InlineVisual;
  onError?: (err: Error) => void;
  onReady?: (info: { visualId: string; pageName: string }) => void;
  /** Render height of the Power BI iframe (px). Defaults to 280. */
  height?: number;
  /** Forwarded to the fallback `<InlineChart>` for the "+ Add to widgets" action. */
  onAddToPage?: (visual: InlineVisual) => void;
  isPinned?: boolean;
}

interface EmbedState {
  embedConfig: models.IVisualEmbedConfiguration;
  visualId: string;
  pageName: string;
}

const InlinePowerBIVisual: React.FC<InlinePowerBIVisualProps> = ({
  config,
  report,
  fallbackVisual,
  onError,
  onReady,
  height = 280,
  onAddToPage,
  isPinned,
}) => {
  const [embedState, setEmbedState] = useState<EmbedState | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  // Track whether we've already attempted to materialise for this (report, config)
  // pair so React's strict-mode double-invoke doesn't create two pages.
  const attemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!report) {
        setEmbedState(null);
        setFailed(true);
        return;
      }

      // Build a stable key so we only materialise once per (report, config).
      const key = `${(report as any)?.config?.id ?? 'report'}::${config.visualType}::${config.title ?? ''}::${config.dataFields
        .map(f => `${f.dataRole}|${f.table}|${f.column}|${f.isMeasure ? 'm' : 'c'}`)
        .join(',')}`;
      if (attemptKeyRef.current === key) {
        return;
      }
      attemptKeyRef.current = key;

      setLoading(true);
      setFailed(false);
      try {
        const { visualId, pageName } = await createInlineVisualOnly(report, config, {
          pageNamePrefix: 'AI_InlineChat',
          layout: { x: 0, y: 0, width: 600, height: 320 },
        });

        const pbiConfig = await apiService.getPowerBIConfig(visualId);
        const resolvedTokenType =
          pbiConfig.tokenType === 'Aad' ? models.TokenType.Aad : models.TokenType.Embed;

        const visualEmbedConfiguration: models.IVisualEmbedConfiguration = {
          type: 'visual',
          embedUrl: pbiConfig.embedUrl,
          accessToken: pbiConfig.accessToken,
          tokenType: resolvedTokenType,
          visualName: visualId,
          pageName: pageName,
          settings: {
            background: models.BackgroundType.Transparent,
          },
        };

        if (cancelled) return;
        setEmbedState({ embedConfig: visualEmbedConfiguration, visualId, pageName });
        setFailed(false);
        onReady?.({ visualId, pageName });
      } catch (err: any) {
        if (cancelled) return;
        console.warn('InlinePowerBIVisual: falling back to Recharts', err);
        setFailed(true);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, config]);

  // Fallback path: report not authoring-capable, or materialisation failed.
  if (!report || failed) {
    return (
      <div className="inline-chart-pbi-fallback">
        <InlineChart
          visual={fallbackVisual}
          onAddToPage={onAddToPage}
          isPinned={isPinned}
        />
        <div
          className="inline-chart-footer"
          style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}
        >
          Showing Recharts preview — open the Full report once to enable Power BI
          embedded visuals.
        </div>
      </div>
    );
  }

  if (loading || !embedState) {
    return (
      <div
        className="inline-chart"
        role="figure"
        aria-label={config.title}
        style={{ height: height + 40 }}
      >
        <div className="inline-chart-header">
          <div className="inline-chart-title" title={config.title}>
            {config.title}
          </div>
        </div>
        <div
          className="inline-chart-body"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span style={{ fontSize: 12, color: '#64748b' }}>Loading visual…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-chart" role="figure" aria-label={config.title}>
      <div className="inline-chart-header">
        <div className="inline-chart-title" title={config.title}>
          {config.title}
        </div>
        {isPinned ? (
          <span
            className="inline-chart-add-button is-pinned"
            title="This visual has been added to the Power BI Widgets tab"
          >
            ✓ Added to widgets
          </span>
        ) : (
          onAddToPage && (
            <button
              type="button"
              className="inline-chart-add-button"
              onClick={() => onAddToPage(fallbackVisual)}
              title="Add this visual to your Power BI report"
            >
              ＋ Add to widgets
            </button>
          )
        )}
      </div>
      <div
        className="inline-chart-body"
        style={{ height, width: '100%', padding: 0 }}
      >
        <PowerBIEmbed
          embedConfig={embedState.embedConfig}
          cssClassName="inline-pbi-embed-frame"
        />
      </div>
    </div>
  );
};

export default InlinePowerBIVisual;
