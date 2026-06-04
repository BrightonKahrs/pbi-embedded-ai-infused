import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models, Report, Page } from 'powerbi-client';
import 'powerbi-report-authoring'; // Extends Page with createVisual and other authoring methods
import { apiService } from '../services/api';
import './PowerBIReport.css';

interface PowerBIReportProps {
  reportId?: string;
  visualId?: string;
  pageName?: string;
  embedType?: 'report' | 'visual';
  editMode?: boolean; // Enable edit mode for visual authoring
  /**
   * When `editMode` is enabled, hide the Power BI edit chrome (action/status
   * bars, fields/visualizations panes, visual headers, and the top edit bar)
   * so the report still looks like a normal viewer to end users while we
   * retain authoring permissions under the hood. Defaults to false.
   */
  hideEditBar?: boolean;
  onDataSelected?: (visualId: string, event: any) => void;
  onVisualRef?: (visualId: string, visualRef: any) => void;
  onReportLoaded?: (report: Report, page: Page | null) => void;
}

const PowerBIReport: React.FC<PowerBIReportProps> = ({ reportId, visualId, pageName, embedType = 'report', editMode = false, hideEditBar = false, onDataSelected, onVisualRef, onReportLoaded }) => {
  // Build a "bootstrap" embed config — no embedUrl, no accessToken — so
  // powerbi-client-react synchronously calls `powerbi.bootstrap(...)` on
  // mount and the Power BI iframe shell appears immediately, before the
  // backend round-trip for the real embed token completes. Once the real
  // config arrives we set it in state; the component's componentDidUpdate
  // detects the change (via lodash.isequal) and finishes the embed in
  // place without tearing down the iframe.
  const buildBootstrapConfig = ():
    | models.IReportEmbedConfiguration
    | models.IVisualEmbedConfiguration => {
    if (embedType === 'visual' && visualId) {
      return {
        type: 'visual',
        tokenType: models.TokenType.Embed,
        embedUrl: '',
        accessToken: '',
        visualName: visualId,
        pageName: pageName || '',
      } as models.IVisualEmbedConfiguration;
    }
    return {
      type: 'report',
      tokenType: models.TokenType.Embed,
      embedUrl: '',
      accessToken: '',
    } as models.IReportEmbedConfiguration;
  };

  const [embedConfig, setEmbedConfig] = useState<
    models.IReportEmbedConfiguration | models.IVisualEmbedConfiguration
  >(buildBootstrapConfig);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Reset to a fresh bootstrap config whenever the key props change so the
    // iframe shell shows immediately while the new token is fetched.
    setEmbedConfig(buildBootstrapConfig());
    setError('');
    loadPowerBIConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, visualId, embedType, editMode, hideEditBar, pageName]);

  const loadPowerBIConfig = async () => {
    try {
      setError('');
      
      // Get config with optional visual ID
      const config = await apiService.getPowerBIConfig(visualId);
      
      const resolvedTokenType = config.tokenType === 'Aad' ? models.TokenType.Aad : models.TokenType.Embed;

      if (embedType === 'visual' && visualId) {
        // Visual embedding configuration - requires both visualName and pageName
        if (!pageName) {
          throw new Error('Page name is required for visual embedding. Please specify the page name.');
        }
        
        const visualEmbedConfiguration: models.IVisualEmbedConfiguration = {
          type: 'visual',
          embedUrl: config.embedUrl,
          accessToken: config.accessToken,
          tokenType: resolvedTokenType,
          visualName: visualId,
          pageName: pageName, // Required for visual embedding
          settings: {
            background: models.BackgroundType.Transparent,
            // Scale the visual to fit the surrounding widget tile instead of
            // rendering at its authored size (which would otherwise overflow
            // or crop on small widget tiles).
            layoutType: models.LayoutType.Custom,
            customLayout: {
              displayOption: models.DisplayOption.FitToPage,
            },
            // Hide the per-visual chrome (header menu, ellipsis) inside tiles.
            visualSettings: {
              visualHeaders: [
                {
                  settings: {
                    visible: false,
                  },
                },
              ],
            },
          },
        };
        
        setEmbedConfig(visualEmbedConfiguration);
      } else {
        // Report embedding configuration
        const useEditMode = editMode;
        const reportEmbedConfiguration: models.IReportEmbedConfiguration = {
          type: 'report',
          embedUrl: config.embedUrl,
          accessToken: config.accessToken,
          tokenType: resolvedTokenType,
          viewMode: useEditMode ? models.ViewMode.Edit : models.ViewMode.View,
          permissions: useEditMode ? models.Permissions.All : models.Permissions.Read,
          settings: {
            panes: {
              filters: {
                expanded: false,
                visible: false,
              },
              pageNavigation: {
                visible: false,
              },
              // Hide authoring panes when running in hidden-edit mode so the
              // viewer looks like a normal embedded report.
              ...(useEditMode && hideEditBar
                ? {
                    fields: { visible: false },
                    visualizations: { visible: false },
                  }
                : {}),
            },
            background: models.BackgroundType.Transparent,
            ...(useEditMode && hideEditBar
              ? {
                  bars: {
                    actionBar: { visible: false },
                    statusBar: { visible: false },
                  },
                }
              : {}),
          },
          ...(useEditMode && hideEditBar ? { hideEditBar: true } : {}),
        } as models.IReportEmbedConfiguration;
        
        setEmbedConfig(reportEmbedConfiguration);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load Power BI configuration. Please ensure the backend is running and configured.');
      console.error('Error loading Power BI config:', err);
    }
  };

  if (error) {
    return (
      <div className="powerbi-container">
        <div className="error-state">
          <h3>⚠️ Configuration Required</h3>
          <p>{error}</p>
          <div className="setup-instructions">
            <h4>Setup Instructions:</h4>
            <ol>
              <li>Configure your Power BI embed URL and access token in the backend <code>.env</code> file</li>
              <li>Set <code>POWERBI_EMBED_URL</code> and <code>POWERBI_ACCESS_TOKEN</code></li>
              <li>Restart the backend server</li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <button onClick={loadPowerBIConfig} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!embedConfig) {
    return null;
  }

  return (
    <div className="powerbi-container">
      <PowerBIEmbed
        embedConfig={embedConfig}
        cssClassName="powerbi-report-frame"
        getEmbeddedComponent={(embeddedComponent) => {
          // powerbi-client-react invokes this callback twice when the
          // bootstrap pattern is in play: once for the bootstrap shell (no
          // real connection) and again once the full embed config is
          // applied. Skip the bootstrap pass so consumers don't try to
          // call report.getPages() etc. on a stub.
          const isBootstrapPass =
            !('accessToken' in embedConfig) || !embedConfig.accessToken;
          if (isBootstrapPass) {
            console.log('Power BI bootstrap iframe mounted (awaiting token)');
            return;
          }
          console.log('Power BI Component Embedded:', embeddedComponent);
          
          // For full report embedding, store the report reference
          if (embedType === 'report' && onReportLoaded && embeddedComponent) {
            const report = embeddedComponent as Report;
            
            // Call onReportLoaded immediately with the report
            // The parent can get the page when needed using report.getPages()
            console.log('Passing report to parent');
            onReportLoaded(report, null);
            
            // Also listen for loaded event to pass the page
            report.on('loaded', async () => {
              try {
                const pages = await report.getPages();
                const activePage = pages.find(p => p.isActive) || pages[0] || null;
                console.log('Report loaded event, active page:', activePage?.displayName);
                onReportLoaded(report, activePage);
              } catch (error) {
                console.error('Error getting active page on load:', error);
              }
            });
          }
          
          // Register the visual reference for cross-filtering (only for visuals)
          if (embedType === 'visual' && visualId && onVisualRef) {
            onVisualRef(visualId, embeddedComponent);
          }
          
          // Set up cross-filtering event listeners for visuals
          if (embedType === 'visual' && visualId && onDataSelected && embeddedComponent) {
            // Listen for data selection events
            embeddedComponent.on('dataSelected', (event: any) => {
              console.log('Data selected in visual:', visualId, event);
              onDataSelected(visualId, event);
            });
            
            // Listen for selection changed events (alternative event)
            embeddedComponent.on('selectionChanged', (event: any) => {
              console.log('Selection changed in visual:', visualId, event);
              onDataSelected(visualId, event);
            });
            
            // Listen for visual clicked events (for additional interaction)
            embeddedComponent.on('visualClicked', (event: any) => {
              console.log('Visual clicked:', visualId, event);
              onDataSelected(visualId, event);
            });
            
            // Clean up event listeners when component unmounts
            return () => {
              try {
                embeddedComponent.off('dataSelected');
                embeddedComponent.off('selectionChanged');
                embeddedComponent.off('visualClicked');
                if (onVisualRef) {
                  onVisualRef(visualId, null); // Unregister the reference
                }
              } catch (error) {
                console.warn('Error cleaning up event listeners:', error);
              }
            };
          }
        }}
      />
    </div>
  );
};

export default PowerBIReport;
