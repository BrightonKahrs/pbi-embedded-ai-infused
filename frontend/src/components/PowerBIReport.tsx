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
}

const PowerBIReport: React.FC<PowerBIReportProps> = ({ reportId, visualId, pageName, embedType = 'report' }) => {
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
      <div className="powerbi-header">
        <h3>
          {embedType === 'visual' ? '🎨 Visual' : '📊 Report'} Embedding
          {embedType === 'visual' && visualId && (
            <span className="visual-id-display"> - {visualId}</span>
          )}
        </h3>
      </div>
      <PowerBIEmbed
        embedConfig={embedConfig}
        cssClassName="powerbi-report-frame"
        getEmbeddedComponent={(embeddedReport) => {
          console.log('Power BI Report Embedded:', embeddedReport);
        }}
      />
    </div>
  );
};

export default PowerBIReport;
