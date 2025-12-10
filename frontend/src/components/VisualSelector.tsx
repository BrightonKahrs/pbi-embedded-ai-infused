import React, { useEffect, useState } from 'react';
import { apiService, PowerBIVisualsResponse, PowerBIVisual } from '../services/api';
import './VisualSelector.css';

interface VisualSelectorProps {
  onVisualSelect: (visualId: string) => void;
  onPageSelect?: (pageName: string) => void;
  selectedVisualId?: string;
  selectedPageName?: string;
}

const VisualSelector: React.FC<VisualSelectorProps> = ({ onVisualSelect, onPageSelect, selectedVisualId, selectedPageName }) => {
  const [visuals, setVisuals] = useState<PowerBIVisualsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadVisuals();
  }, []);

  const loadVisuals = async () => {
    try {
      setLoading(true);
      setError('');
      const visualsData = await apiService.getPowerBIVisuals();
      setVisuals(visualsData);
      
      // Auto-expand the first page if there are any visuals
      if (visualsData.pages && Object.keys(visualsData.pages).length > 0) {
        const firstPageName = Object.keys(visualsData.pages)[0];
        setExpandedPages(new Set([firstPageName]));
      }
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
        <h3>Report Pages ({visuals.totalPages} available)</h3>
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
          <div 
            key={page.name} 
            className={`page-info ${selectedPageName === page.name ? 'selected' : ''}`}
            onClick={() => onPageSelect && onPageSelect(page.name)}
            style={{ cursor: onPageSelect ? 'pointer' : 'default' }}
          >
            <div className="page-name">{page.displayName}</div>
            <div className="page-details">
              <span className="page-id">ID: {page.name}</span>
              <span className="page-order">Order: {page.order}</span>
            </div>
            {onPageSelect && (
              <div className="select-indicator">
                {selectedPageName === page.name ? '✓ Selected' : 'Click to select'}
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
    </div>
  );
};

export default VisualSelector;