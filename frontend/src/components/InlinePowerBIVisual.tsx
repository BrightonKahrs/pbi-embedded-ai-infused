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

      setFailed(false);

      // Race the materialise + token fetch against a short timeout. The
      // PBI authoring API often fails silently (the in-memory visual's
      // setProperty calls 401 against the service), so we fall back to
      // Recharts quickly rather than show a permanent "Loading…" pill.
      const TIMEOUT_MS = 3000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('inline-pbi-embed-timeout')), TIMEOUT_MS);
      });

      try {
        const materialised = await Promise.race([
          (async () => {
            const result = await createInlineVisualOnly(report, config, {
              pageNamePrefix: 'AI_InlineChat',
              layout: { x: 0, y: 0, width: 600, height: 320 },
            });
            if (!result) {
              throw new Error('inline-pbi-materialise-aborted');
            }
            const pbiConfig = await apiService.getPowerBIConfig(result.visualId);
            return { result, pbiConfig };
          })(),
          timeoutPromise,
        ]);

        const { result, pbiConfig } = materialised;
        const resolvedTokenType =
          pbiConfig.tokenType === 'Aad' ? models.TokenType.Aad : models.TokenType.Embed;

        const visualEmbedConfiguration: models.IVisualEmbedConfiguration = {
          type: 'visual',
          embedUrl: pbiConfig.embedUrl,
          accessToken: pbiConfig.accessToken,
          tokenType: resolvedTokenType,
          visualName: result.visualId,
          pageName: result.pageName,
          settings: {
            background: models.BackgroundType.Transparent,
          },
        };

        if (cancelled) return;
        setEmbedState({
          embedConfig: visualEmbedConfiguration,
          visualId: result.visualId,
          pageName: result.pageName,
        });
        setFailed(false);
        onReady?.({ visualId: result.visualId, pageName: result.pageName });
      } catch (err: any) {
        if (cancelled) return;
        // Quiet — falling back to Recharts is the expected outcome whenever
        // the report isn't in authoring mode or the service rejects the
        // in-memory visual's property writes.
        console.debug('InlinePowerBIVisual: falling back to Recharts', err);
        setFailed(true);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, config]);

  // Fallback path: report not authoring-capable, materialisation failed,
  // or the embed didn't complete inside our timeout. Show the Recharts
  // preview with a small caption — no permanent "Loading…" pill.
  if (!report || failed || !embedState) {
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
          Preview shown with charting library — pin to widgets for the full Power BI visual.
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
