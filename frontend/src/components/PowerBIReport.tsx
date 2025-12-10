import React, { useEffect, useState } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import { apiService } from '../services/api';
import './PowerBIReport.css';

interface PowerBIReportProps {
  reportId?: string;
}

const PowerBIReport: React.FC<PowerBIReportProps> = ({ reportId }) => {
  const [embedConfig, setEmbedConfig] = useState<models.IReportEmbedConfiguration | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPowerBIConfig();
  }, [reportId]);

  const loadPowerBIConfig = async () => {
    try {
      setLoading(true);
      setError('');
      const config = await apiService.getPowerBIConfig();
      
      const embedConfiguration: models.IReportEmbedConfiguration = {
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
      
      setEmbedConfig(embedConfiguration);
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
          <p>Loading Power BI Report...</p>
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
        getEmbeddedComponent={(embeddedReport) => {
          console.log('Power BI Report Embedded:', embeddedReport);
        }}
      />
    </div>
  );
};

export default PowerBIReport;
