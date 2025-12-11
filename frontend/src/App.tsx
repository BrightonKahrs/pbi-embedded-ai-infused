import React, { useState, useRef, useCallback, useEffect } from 'react';
import { models } from 'powerbi-client';
import './App.css';
import PowerBIReport from './components/PowerBIReport';
import VisualSelector from './components/VisualSelector';
import AIChat from './components/AIChat';
import { apiService } from './services/api';

/**
 * Cross-Filtering Feature Implementation:
 * 
 * When multiple visuals are selected and cross-filtering is enabled:
 * 1. Each visual registers itself in visualRefsMap for communication
 * 2. Data selection events (dataSelected/dataPointSelection) are captured 
 * 3. Selected data points are converted to Power BI Basic filters
 * 4. Filters are applied to all other visuals except the source
 * 5. Users can toggle cross-filtering on/off via checkbox
 * 
 * This allows users to click on data points in one visual and see
 * related data filtered across all other embedded visuals.
 */

function App() {
  const [embedType, setEmbedType] = useState<'report' | 'visual'>('report');
  const [visualIds, setVisualIds] = useState<string[]>([]);
  const [pageName, setPageName] = useState<string>('');  
  const [discoveredPages, setDiscoveredPages] = useState<any[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark' | 'highContrast'>('light');
  
  // Store references to embedded visuals for cross-filtering
  const visualRefsMap = useRef<Map<string, any>>(new Map());
  const [crossFilterEnabled, setCrossFilterEnabled] = useState<boolean>(true);

  // Load available pages on component mount
  useEffect(() => {
    const loadPages = async () => {
      try {
        const visualsData = await apiService.getPowerBIVisuals();
        setDiscoveredPages(visualsData.pagesInfo || []);
      } catch (error) {
        console.error('Failed to load pages:', error);
      }
    };
    loadPages();
  }, []);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  const handleVisualSelect = (selectedVisualId: string) => {
    setVisualIds(prev => {
      if (prev.includes(selectedVisualId)) {
        // Remove if already selected
        return prev.filter(id => id !== selectedVisualId);
      } else {
        // Add to selection
        return [...prev, selectedVisualId];
      }
    });
    if (selectedVisualId && pageName) {
      setEmbedType('visual');
    }
  };

  const handlePageSelect = (selectedPageName: string) => {
    setPageName(selectedPageName);
  };

  const clearAllVisuals = () => {
    setVisualIds([]);
    setPageName('');
    visualRefsMap.current.clear();
  };

  // Handle cross-filtering between visuals
  const handleVisualDataSelected = useCallback(async (sourceVisualId: string, event: any) => {
    if (!crossFilterEnabled || visualIds.length <= 1) return;

    try {
      const dataPoints = event.detail?.dataPoints;
      if (!dataPoints || dataPoints.length === 0) {
        // Clear filters on all other visuals when no selection
        await clearFiltersOnOtherVisuals(sourceVisualId);
        return;
      }

      const firstDataPoint = dataPoints[0];
      const target = firstDataPoint.identity?.[0]?.target;
      const selectedValue = firstDataPoint.values?.[0]?.value ?? firstDataPoint.identity?.[0]?.equals;

      if (!target || selectedValue === undefined) {
        console.warn('Invalid data point structure for cross-filtering');
        return;
      }

      // Create basic filter
      const basicFilter = {
        $schema: "http://powerbi.com/product/schema#basic",
        target: { table: target.table, column: target.column },
        operator: "In",
        values: [selectedValue],
        filterType: models.FilterType.Basic
      };

      // Apply filter to all other visuals
      const promises: Promise<void>[] = [];
      visualRefsMap.current.forEach((visualRef, visualId) => {
        if (visualId !== sourceVisualId && visualRef) {
          promises.push(
            visualRef.updateFilters(models.FiltersOperations.Replace, [basicFilter])
              .catch((filterError: any) => {
                console.warn(`Failed to apply filter to visual ${visualId}:`, filterError);
              })
          );
        }
      });
      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error in cross-filtering:', error);
    }
  }, [crossFilterEnabled, visualIds]);

  // Clear filters on all visuals except the source
  const clearFiltersOnOtherVisuals = async (sourceVisualId: string) => {
    const promises: Promise<void>[] = [];
    visualRefsMap.current.forEach((visualRef, visualId) => {
      if (visualId !== sourceVisualId && visualRef) {
        promises.push(
          visualRef.removeFilters()
            .catch((error: any) => {
              console.warn(`Failed to clear filters on visual ${visualId}:`, error);
            })
        );
      }
    });
    await Promise.allSettled(promises);
  };

  // Register visual reference for cross-filtering
  const registerVisualRef = (visualId: string, visualRef: any) => {
    if (visualRef) {
      visualRefsMap.current.set(visualId, visualRef);
    } else {
      visualRefsMap.current.delete(visualId);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-top">
          <div className="header-content">
            <h1>📊 Power BI Embedded with AI</h1>
            <p>Analyze your data with AI-powered insights</p>
          </div>
          <div className="theme-selector">
            <label style={{ fontSize: '14px', color: 'white', fontWeight: '500', marginRight: '8px' }}>Theme:</label>
            <select 
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'highContrast')}
              style={{ 
                padding: '6px 10px', 
                borderRadius: '4px', 
                border: 'none', 
                fontSize: '14px',
                backgroundColor: 'white',
                cursor: 'pointer'
              }}
            >
              <option value="light">Light Mode</option>
              <option value="dark">Dark Mode</option>
              <option value="highContrast">High Contrast</option>
            </select>
          </div>
        </div>
        
        {/* Tab controls */}
        <div className="tab-controls" style={{ marginTop: '20px' }}>
          <button 
            className={`tab ${embedType === 'report' ? 'active' : ''}`}
            onClick={() => setEmbedType('report')}
          >
            Full report
          </button>
          <button 
            className={`tab ${embedType === 'visual' ? 'active' : ''}`}
            onClick={() => setEmbedType('visual')}
          >
            Power BI Widgets
          </button>
        </div>

        {/* Visual selection controls - shown when Power BI Widgets tab is active */}
        {embedType === 'visual' && (
          <div className="visual-controls" style={{ 
            marginTop: '15px', 
            display: 'flex', 
            gap: '15px', 
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: 'white', fontWeight: '500' }}>Page:</label>
              <select 
                value={pageName}
                onChange={(e) => setPageName(e.target.value)}
                style={{ 
                  padding: '6px 10px', 
                  borderRadius: '4px', 
                  border: 'none', 
                  fontSize: '14px',
                  width: '160px',
                  backgroundColor: 'white'
                }}
              >
                <option value="">Select a page...</option>
                {discoveredPages.map((page) => (
                  <option key={page.name} value={page.name}>
                    {page.displayName || page.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: 'white', fontWeight: '500' }}>Visual IDs:</label>
              <input 
                type="text" 
                placeholder="visual1, visual2" 
                value={visualIds.join(', ')}
                onChange={(e) => setVisualIds(e.target.value.split(',').map(id => id.trim()).filter(id => id))}
                style={{ 
                  padding: '6px 10px', 
                  borderRadius: '4px', 
                  border: 'none', 
                  fontSize: '14px',
                  width: '200px'
                }}
              />
              {visualIds.length > 0 && (
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)' }}>
                  ({visualIds.length} selected)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                onClick={clearAllVisuals} 
                style={{ 
                  padding: '6px 12px', 
                  fontSize: '12px', 
                  background: 'rgba(255,255,255,0.2)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px', 
                  cursor: 'pointer' 
                }}
              >
                Clear
              </button>
              {visualIds.length > 1 && (
                <label style={{ fontSize: '12px', color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input 
                    type="checkbox" 
                    checked={crossFilterEnabled} 
                    onChange={(e) => setCrossFilterEnabled(e.target.checked)}
                  />
                  Cross-filter
                </label>
              )}
            </div>
          </div>
        )}


      </header>
      <div className="App-content">
        <div className="report-section">
          {embedType === 'visual' && visualIds.length > 1 ? (
            /* Render multiple visuals */
            <div className="multi-visual-container">
              <div className="multi-visual-header">
                <h3>📊 Multiple Visuals ({visualIds.length} selected)</h3>
                {crossFilterEnabled && (
                  <p style={{ margin: '4px 0', fontSize: '12px', color: '#666' }}>
                    🔗 Cross-filtering enabled - Click on data points to filter other visuals
                  </p>
                )}
              </div>
              <div className="multi-visual-grid">
                {visualIds.map((visualId, index) => (
                  <div key={visualId} className="visual-container">
                    <PowerBIReport 
                      embedType="visual"
                      visualId={visualId}
                      pageName={pageName}
                      onDataSelected={crossFilterEnabled ? handleVisualDataSelected : undefined}
                      onVisualRef={registerVisualRef}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Render single visual or report */
            <PowerBIReport 
              embedType={embedType}
              visualId={embedType === 'visual' && visualIds.length > 0 ? visualIds[0] : undefined}
              pageName={embedType === 'visual' ? pageName : undefined}
            />
          )}
        </div>
        <div className="chat-section">
          <AIChat />
        </div>
      </div>
    </div>
  );
}

export default App;
