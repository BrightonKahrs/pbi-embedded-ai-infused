import React, { useEffect, useState, useRef } from 'react';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import { apiService, PowerBIVisualsResponse, PowerBIVisual } from '../services/api';
import './VisualSelector.css';

interface VisualSelectorProps {
  onVisualSelect: (visualId: string) => void;
  onPageSelect?: (pageName: string) => void;
  selectedVisualIds?: string[];
  selectedPageName?: string;
}

const VisualSelector: React.FC<VisualSelectorProps> = ({ onVisualSelect, onPageSelect, selectedVisualIds = [], selectedPageName }) => {
  const [visuals, setVisuals] = useState<PowerBIVisualsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [discoveredVisuals, setDiscoveredVisuals] = useState<{[pageName: string]: PowerBIVisual[]}>({});
  const [reportEmbedConfig, setReportEmbedConfig] = useState<models.IReportEmbedConfiguration | null>(null);
  const hiddenReportRef = useRef<any>(null);

  useEffect(() => {
    loadVisuals();
  }, []);

  const loadVisuals = async () => {
    try {
      setLoading(true);
      setError('');
      const visualsData = await apiService.getPowerBIVisuals();
      setVisuals(visualsData);
      
      // Setup hidden report for visual discovery
      await setupHiddenReport();
      
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load visuals');
      console.error('Error loading visuals:', err);
    } finally {
      setLoading(false);
    }
  };

  const togglePage = (pageName: string) => {
    const newExpanded = new Set(expandedPages);
    if (newExpanded.has(pageName)) {
      newExpanded.delete(pageName);
    } else {
      newExpanded.add(pageName);
    }
    setExpandedPages(newExpanded);
  };

  const handleVisualSelect = (visualId: string) => {
    onVisualSelect(visualId);
  };

  const discoverVisualsOnPage = async (pageName: string) => {
    if (!hiddenReportRef.current || discoveredVisuals[pageName]) {
      return; // Already discovered or no report
    }

    try {
      setLoading(true);
      
      // Get all pages from the hidden report
      const pages = await hiddenReportRef.current.getPages();
      const targetPage = pages.find((p: any) => p.name === pageName);
      
      if (targetPage) {
        // Get visuals from the specific page
        const pageVisuals = await targetPage.getVisuals();
        
        const visualList: PowerBIVisual[] = pageVisuals.map((visual: any) => ({
          visualId: visual.name,
          title: visual.title || `${visual.type} (${visual.name})`,
          type: visual.type
        }));
        
        setDiscoveredVisuals(prev => ({
          ...prev,
          [pageName]: visualList
        }));
        
        // Auto-expand this page
        setExpandedPages(prev => new Set(prev).add(pageName));
      }
    } catch (err) {
      console.error('Error discovering visuals:', err);
      setError(`Failed to discover visuals on page: ${pageName}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePageClick = async (pageName: string, pageDisplayName: string) => {
    if (onPageSelect) {
      onPageSelect(pageName);
    }
    
    // Discover visuals on this page
    await discoverVisualsOnPage(pageName);
  };

  const setupHiddenReport = async () => {
    try {
      // Get Power BI config for the hidden report
      const config = await apiService.getPowerBIConfig();
      
      const hiddenConfig: models.IReportEmbedConfiguration = {
        type: 'report',
        embedUrl: config.embedUrl,
        accessToken: config.accessToken,
        tokenType: models.TokenType.Embed,
        settings: {
          panes: {
            filters: { visible: false },
            pageNavigation: { visible: false }
          },
          background: models.BackgroundType.Transparent,
        }
      };
      
      setReportEmbedConfig(hiddenConfig);
    } catch (err) {
      console.error('Error setting up hidden report:', err);
      setError('Failed to setup visual discovery');
    }
  };

  const renderLoadingIndicator = () => {
    if (loading) {
      return (
        <div className="loading-indicator">
          <div className="mini-spinner"></div>
          <span>Loading...</span>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="visual-selector">
        <div className="loading">Loading available visuals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="visual-selector">
        <div className="error">{error}</div>
        <button onClick={loadVisuals} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  if (!visuals || visuals.totalPages === 0) {
    return (
      <div className="visual-selector">
        <div className="no-visuals">
          <p>No pages available for visual discovery</p>
          <p><strong>Note:</strong> Visual discovery requires embedding the report first</p>
        </div>
      </div>
    );
  }

  return (
    <div className="visual-selector">
      <div className="visual-selector-header">
        <div className="header-left">
          <h3>Visual Selector</h3>
          {renderLoadingIndicator()}
        </div>
        <button onClick={loadVisuals} className="refresh-button">
          🔄 Refresh
        </button>
      </div>
      
      <div className="manual-input-section">
        <h4>Enter Visual ID:</h4>
        <p>Enter a visual ID from your Power BI report:</p>
        <input 
          type="text" 
          placeholder="Enter Visual ID (e.g., 'visual1', 'chart_123')" 
          onChange={(e) => handleVisualSelect(e.target.value)}
          className="manual-visual-input"
        />
      </div>
      
      {/* Hidden report for visual discovery */}
      {reportEmbedConfig && (
        <div style={{ display: 'none' }}>
          <PowerBIEmbed
            embedConfig={reportEmbedConfig as models.IReportEmbedConfiguration}
            cssClassName="hidden-report"
            getEmbeddedComponent={(embeddedReport) => {
              hiddenReportRef.current = embeddedReport;
              console.log('Hidden report loaded for visual discovery');
            }}
          />
        </div>
      )}
    </div>
  );
};

export default VisualSelector;