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
          <h3>Report Pages ({visuals?.totalPages || 0} available)</h3>
          {renderLoadingIndicator()}
        </div>
        <button onClick={loadVisuals} className="refresh-button">
          🔄 Refresh
        </button>
      </div>
      
      <div className="info-section">
        <div className="info-box">
          <strong>Visual Discovery Note:</strong>
          <p>{visuals.note}</p>
          <p><em>{visuals.instructions}</em></p>
        </div>
      </div>
      
      <div className="pages-container">
        <h4>Available Pages:</h4>
        {visuals.pagesInfo?.map((page: any) => (
          <div key={page.name}>
            <div 
              className={`page-info ${selectedPageName === page.name ? 'selected' : ''}`}
              onClick={() => handlePageClick(page.name, page.displayName)}
              style={{ cursor: 'pointer' }}
            >
              <div className="page-name">{page.displayName}</div>
              <div className="page-details">
                <span className="page-id">ID: {page.name}</span>
                <span className="page-order">Order: {page.order}</span>
              </div>
              <div className="select-indicator">
                {selectedPageName === page.name ? '✓ Selected' : 'Click to discover visuals'}
              </div>
            </div>
            
            {/* Show discovered visuals for this page */}
            {discoveredVisuals[page.name] && (
              <div className="visuals-list" style={{ marginLeft: '16px', marginTop: '8px' }}>
                <h5>Visuals on {page.displayName}:</h5>
                {discoveredVisuals[page.name].map((visual) => {
                  const isSelected = selectedVisualIds.includes(visual.visualId);
                  return (
                    <div
                      key={visual.visualId}
                      className={`visual-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleVisualSelect(visual.visualId)}
                    >
                      <div className="visual-header">
                        <div className="visual-title">{visual.title}</div>
                        <div className="selection-indicator">
                          {isSelected ? '✓ Selected' : '+ Select'}
                        </div>
                      </div>
                      <div className="visual-type">{visual.type}</div>
                      <div className="visual-id">{visual.visualId}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        
        <div className="manual-input-section">
          <h4>Manual Visual ID Input:</h4>
          <p>Enter a visual ID if you know it from the report:</p>
          <input 
            type="text" 
            placeholder="Enter Visual ID (e.g., 'visual1', 'chart_123')" 
            onChange={(e) => handleVisualSelect(e.target.value)}
            className="manual-visual-input"
          />
        </div>
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