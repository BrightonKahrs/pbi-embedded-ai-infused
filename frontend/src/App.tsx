import React, { useState, useRef, useCallback } from 'react';
import { models } from 'powerbi-client';
import './App.css';
import PowerBIReport from './components/PowerBIReport';
import VisualSelector from './components/VisualSelector';
import AIChat from './components/AIChat';

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
  
  // Store references to embedded visuals for cross-filtering
  const visualRefsMap = useRef<Map<string, any>>(new Map());
  const [crossFilterEnabled, setCrossFilterEnabled] = useState<boolean>(true);

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
        <h1>📊 Power BI Embedded with AI</h1>
        <p>Analyze your data with AI-powered insights</p>
        
        {/* Embedding controls */}
        <div className="embed-controls" style={{ marginTop: '20px' }}>
          <label>
            <input 
              type="radio" 
              value="report" 
              checked={embedType === 'report'} 
              onChange={(e) => setEmbedType('report')} 
            />
            Full Report
          </label>
          <label style={{ marginLeft: '15px' }}>
            <input 
              type="radio" 
              value="visual" 
              checked={embedType === 'visual'} 
              onChange={(e) => setEmbedType('visual')} 
            />
            Specific Visual
          </label>
        </div>

        {embedType === 'visual' && (
          <div style={{ marginTop: '15px', height: 'calc(100vh - 280px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#e8f4f8', borderRadius: '6px', flexShrink: 0 }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#333' }}>🎯 New: Automatic Visual Discovery!</h4>
              <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', color: '#666' }}>
                <li><strong>Click on any page</strong> in the Visual Selector below to discover its visuals</li>
                <li><strong>Click on a discovered visual</strong> to select it for embedding</li>
                <li><strong>Or manually enter</strong> page name and visual ID if you know them</li>
                <li>The app will automatically embed the selected visual</li>
              </ol>
            </div>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Page Name:</label>
                  <input 
                    type="text" 
                    placeholder="Enter Page Name (e.g., 'ReportSection')" 
                    value={pageName}
                    onChange={(e) => setPageName(e.target.value)}
                    style={{ padding: '8px', width: '200px', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Visual IDs:</label>
                  <input 
                    type="text" 
                    placeholder="Enter Visual IDs (comma-separated)" 
                    value={visualIds.join(', ')}
                    onChange={(e) => setVisualIds(e.target.value.split(',').map(id => id.trim()).filter(id => id))}
                    style={{ padding: '8px', width: '300px', fontFamily: 'monospace' }}
                  />
                  {visualIds.length > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                      {visualIds.length} visual{visualIds.length !== 1 ? 's' : ''} selected
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button onClick={clearAllVisuals} style={{ padding: '8px' }}>
                    Clear All
                  </button>
                  {visualIds.length > 1 && (
                    <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input 
                        type="checkbox" 
                        checked={crossFilterEnabled} 
                        onChange={(e) => setCrossFilterEnabled(e.target.checked)}
                      />
                      Enable Cross-Filtering
                    </label>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <VisualSelector 
                  onVisualSelect={handleVisualSelect}
                  onPageSelect={handlePageSelect}
                  selectedVisualIds={visualIds}
                  selectedPageName={pageName}
                />
              </div>
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
                    <div className="visual-label">
                      Visual {index + 1}: {visualId}
                      {crossFilterEnabled && <span style={{ color: '#007acc', marginLeft: '8px' }}>🔗</span>}
                    </div>
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
