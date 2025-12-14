import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import { apiService } from '../services/api';
import './PowerBIReport.css';

interface PowerBIReportProps {
  reportId?: string;
  visualId?: string;
  pageName?: string;
  embedType?: 'report' | 'visual';
  onDataSelected?: (visualId: string, event: any) => void;
  onVisualRef?: (visualId: string, visualRef: any) => void;
}

const PowerBIReport: React.FC<PowerBIReportProps> = ({ reportId, visualId, pageName, embedType = 'report', onDataSelected, onVisualRef }) => {
  const [embedConfig, setEmbedConfig] = useState<models.IReportEmbedConfiguration | models.IVisualEmbedConfiguration | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPowerBIConfig();
  }, [reportId, visualId, embedType]);

  const loadPowerBIConfig = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Get config with optional visual ID
      const config = await apiService.getPowerBIConfig(visualId);
      
      if (embedType === 'visual' && visualId) {
        // Visual embedding configuration - requires both visualName and pageName
        if (!pageName) {
          throw new Error('Page name is required for visual embedding. Please specify the page name.');
        }
        
        const visualEmbedConfiguration: models.IVisualEmbedConfiguration = {
          type: 'visual',
          embedUrl: config.embedUrl,
          accessToken: config.accessToken,
          tokenType: models.TokenType.Embed,
          visualName: visualId,
          pageName: pageName, // Required for visual embedding
          settings: {
            background: models.BackgroundType.Transparent,
          }
        };
        
        setEmbedConfig(visualEmbedConfiguration);
      } else {
        // Report embedding configuration
        const reportEmbedConfiguration: models.IReportEmbedConfiguration = {
          type: 'report',
          embedUrl: config.embedUrl,
          accessToken: config.accessToken,
          tokenType: models.TokenType.Embed,
          settings: {
            panes: {
              filters: {
                expanded: false,
                visible: true
              }
            },
            background: models.BackgroundType.Transparent,
          }
        };
        
        setEmbedConfig(reportEmbedConfiguration);
      }
      
      setLoading(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load Power BI configuration. Please ensure the backend is running and configured.');
      setLoading(false);
      console.error('Error loading Power BI config:', err);
    }
  };

  if (loading) {
    return (
      <div className="powerbi-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading Power BI {embedType === 'visual' ? 'Visual' : 'Report'}...</p>
        </div>
      </div>
    );
  }

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
          console.log('Power BI Component Embedded:', embeddedComponent);
          
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
