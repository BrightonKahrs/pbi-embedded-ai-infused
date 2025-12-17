import React, { useState, useEffect } from 'react';
import { Report } from 'powerbi-client';

interface VisualInfo {
  name: string;
  type: string;
  title: string;
  pageName?: string;
  pageDisplayName?: string;
}

interface ExistingReportViewProps {
  onClose: () => void;
  onBack: () => void;
  onCreateVisual: (visualId: string, pageName: string) => void;
  discoveredPages: any[];
  report?: Report | null;
  discoveredVisualsMap?: Map<string, any[]>;
}

const ExistingReportView: React.FC<ExistingReportViewProps> = ({
  onClose,
  onBack,
  onCreateVisual,
  discoveredPages,
  report,
  discoveredVisualsMap
}) => {
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [selectedVisualId, setSelectedVisualId] = useState<string>('');
  const [pageVisuals, setPageVisuals] = useState<VisualInfo[]>([]);
  const [isLoadingVisuals, setIsLoadingVisuals] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');

  // Get display name for visual type (defined early so it can be used in useEffect)
  const getVisualTypeDisplayName = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      'clusteredBarChart': 'Bar Chart',
      'clusteredColumnChart': 'Column Chart',
      'columnChart': 'Column Chart',
      'barChart': 'Bar Chart',
      'lineChart': 'Line Chart',
      'areaChart': 'Area Chart',
      'pieChart': 'Pie Chart',
      'donutChart': 'Donut Chart',
      'card': 'Card',
      'multiRowCard': 'Multi-row Card',
      'kpi': 'KPI',
      'gauge': 'Gauge',
      'table': 'Table',
      'matrix': 'Matrix',
      'map': 'Map',
      'filledMap': 'Filled Map',
      'treemap': 'Treemap',
      'waterfallChart': 'Waterfall Chart',
      'funnelChart': 'Funnel Chart',
      'scatterChart': 'Scatter Chart',
      'ribbonChart': 'Ribbon Chart',
      'lineClusteredColumnComboChart': 'Line & Column Chart',
      'lineStackedColumnComboChart': 'Line & Stacked Column Chart',
      'decompositionTree': 'Decomposition Tree',
      'keyInfluencers': 'Key Influencers',
      'qnaVisual': 'Q&A',
    };
    return typeMap[type] || type;
  };

  // Load visuals when a page is selected - use pre-discovered map if available
  useEffect(() => {
    const loadVisualsForPage = async () => {
      if (!selectedPage) {
        setPageVisuals([]);
        return;
      }

      setSelectedVisualId(''); // Reset selected visual when page changes

      // First, try to use pre-discovered visuals from the map
      if (discoveredVisualsMap && discoveredVisualsMap.has(selectedPage)) {
        const preDiscovered = discoveredVisualsMap.get(selectedPage) || [];
        console.log('Using pre-discovered visuals for page:', selectedPage, preDiscovered);
        setPageVisuals(preDiscovered.map(v => ({
          name: v.name,
          type: v.type,
          title: v.title || getVisualTypeDisplayName(v.type)
        })));
        setLoadError('');
        setIsLoadingVisuals(false);
        return;
      }

      // Fall back to dynamic discovery if no pre-discovered visuals
      if (!report) {
        setPageVisuals([]);
        return;
      }

      setIsLoadingVisuals(true);
      setLoadError('');

      try {
        // Get all pages from the report
        const pages = await report.getPages();
        const targetPage = pages.find(p => p.name === selectedPage);

        if (!targetPage) {
          setLoadError('Page not found');
          setPageVisuals([]);
          return;
        }

        // Get visuals from the selected page
        const visuals = await targetPage.getVisuals();
        
        // Map visuals to our VisualInfo format
        const visualInfos: VisualInfo[] = visuals
          .filter(v => {
            // Filter out certain visual types that shouldn't be pinned
            const excludedTypes = ['slicer', 'textbox', 'shape', 'image', 'actionButton'];
            return !excludedTypes.includes(v.type);
          })
          .map(v => ({
            name: v.name,
            type: v.type,
            title: v.title || getVisualTypeDisplayName(v.type)
          }));

        console.log('Dynamically discovered visuals on page:', visualInfos);
        setPageVisuals(visualInfos);
      } catch (error) {
        console.error('Error discovering visuals:', error);
        setLoadError('Failed to load visuals from page');
        setPageVisuals([]);
      } finally {
        setIsLoadingVisuals(false);
      }
    };

    loadVisualsForPage();
  }, [selectedPage, report, discoveredVisualsMap]);

  // Get icon for visual type
  const getVisualTypeIcon = (type: string): string => {
    const iconMap: { [key: string]: string } = {
      'clusteredBarChart': '📊',
      'clusteredColumnChart': '📊',
      'columnChart': '📊',
      'barChart': '📊',
      'lineChart': '📈',
      'areaChart': '📈',
      'pieChart': '🥧',
      'donutChart': '🍩',
      'card': '🔢',
      'multiRowCard': '🔢',
      'kpi': '🎯',
      'gauge': '⏱️',
      'table': '📋',
      'matrix': '📋',
      'map': '🗺️',
      'filledMap': '🗺️',
      'treemap': '🌳',
      'waterfallChart': '📉',
      'funnelChart': '🔻',
      'scatterChart': '⚫',
    };
    return iconMap[type] || '📊';
  };

  const handleCreateVisual = () => {
    if (selectedVisualId && selectedPage) {
      onCreateVisual(selectedVisualId, selectedPage);
      onClose();
    }
  };

  const isCreateDisabled = !selectedVisualId || !selectedPage;

  const selectedVisual = pageVisuals.find(v => v.name === selectedVisualId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button 
            className="back-button" 
            onClick={onBack}
            aria-label="Back to options"
          >
            ← Back
          </button>
          <h2>Add from Existing Report</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <h3>Step 1: Select a Page</h3>
            <p className="section-description">Choose the report page containing the visual you want to add</p>
            <div className="page-grid">
              {discoveredPages.map((page) => (
                <button
                  key={page.name}
                  className={`page-card ${selectedPage === page.name ? 'selected' : ''}`}
                  onClick={() => setSelectedPage(page.name)}
                >
                  <div className="page-icon">📄</div>
                  <div className="page-name">{page.displayName || page.name}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedPage && (
            <div className="modal-section">
              <h3>Step 2: Select a Visual</h3>
              <p className="section-description">
                Choose the visual you want to add to your canvas
              </p>
              
              {isLoadingVisuals ? (
                <div className="loading-visuals">
                  <span className="spinner">⟳</span> Discovering visuals...
                </div>
              ) : loadError ? (
                <div className="error-message">
                  <span>⚠️</span> {loadError}
                </div>
              ) : pageVisuals.length === 0 ? (
                <div className="no-visuals-message">
                  <p>No visuals found on this page</p>
                  <p className="input-help">💡 Try selecting a different page</p>
                </div>
              ) : (
                <div className="visual-selector-wrapper">
                  <label htmlFor="visual-select" className="input-label">
                    Available Visuals:
                  </label>
                  <select
                    id="visual-select"
                    className="visual-select-dropdown"
                    value={selectedVisualId}
                    onChange={(e) => setSelectedVisualId(e.target.value)}
                  >
                    <option value="">-- Select a visual --</option>
                    {pageVisuals.map((visual) => (
                      <option key={visual.name} value={visual.name}>
                        {getVisualTypeIcon(visual.type)} {visual.title} ({getVisualTypeDisplayName(visual.type)})
                      </option>
                    ))}
                  </select>
                  <p className="input-help">
                    💡 {pageVisuals.length} visual{pageVisuals.length !== 1 ? 's' : ''} found on this page
                  </p>
                </div>
              )}
            </div>
          )}

          {selectedVisual && selectedPage && (
            <div className="modal-section preview-section">
              <h3>Preview</h3>
              <div className="visual-preview-card">
                <div className="preview-icon">{getVisualTypeIcon(selectedVisual.type)}</div>
                <div className="preview-details">
                  <strong>{selectedVisual.title}</strong>
                  <p>Type: {getVisualTypeDisplayName(selectedVisual.type)}</p>
                  <p>Page: {discoveredPages.find(p => p.name === selectedPage)?.displayName || selectedPage}</p>
                  <p className="preview-note">The visual will be added to the canvas when you click "Add to Canvas"</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="btn-create" 
            onClick={handleCreateVisual}
            disabled={isCreateDisabled}
          >
            Add to Canvas
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExistingReportView;
