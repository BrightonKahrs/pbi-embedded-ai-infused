import React, { useState, useRef, useCallback, useEffect } from 'react';
import { models, Report, Page } from 'powerbi-client';
import 'powerbi-report-authoring'; // Extends Page with createVisual method
import './App.css';
import PowerBIReport from './components/PowerBIReport';
import VisualSelector from './components/VisualSelector';
import AIChat from './components/AIChat';
import VisualCreatorModal from './components/VisualCreatorModal';
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
  const [availableVisuals, setAvailableVisuals] = useState<any[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark' | 'highContrast'>('light');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  
  // Store references to embedded visuals for cross-filtering
  const visualRefsMap = useRef<Map<string, any>>(new Map());
  const [crossFilterEnabled, setCrossFilterEnabled] = useState<boolean>(true);
  
  // Store reference to the current report and page for visual creation
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [currentPage, setCurrentPage] = useState<Page | null>(null);

  // Load available pages and visuals on component mount
  useEffect(() => {
    const loadPages = async () => {
      try {
        const visualsData = await apiService.getPowerBIVisuals();
        setDiscoveredPages(visualsData.pagesInfo || []);
        // availableVisuals will be the full visualsInfo array from the API
        if (visualsData.visualsInfo) {
          setAvailableVisuals(visualsData.visualsInfo);
        }
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

  // Handle visual creation from modal
  const handleCreateVisual = (visualId: string, newPageName: string) => {
    setPageName(newPageName);
    setVisualIds(prev => [...prev, visualId]);
    setEmbedType('visual');
  };

  // Open modal - get active page from report dynamically (like in demo)
  const handleOpenModal = async () => {
    // If we're on the full report tab and have a report, get the active page
    if (embedType === 'report' && currentReport) {
      try {
        const pages = await currentReport.getPages();
        const activePage = pages.find(p => p.isActive) || pages[0] || null;
        
        if (activePage) {
          console.log('Got active page for visual creation:', activePage.displayName);
          setCurrentPage(activePage);
        } else {
          console.warn('No active page found in report');
          // Modal will handle embedding its own report
        }
      } catch (error) {
        console.error('Error getting active page:', error);
        // Modal will handle embedding its own report
      }
    } else {
      // When on widgets tab, clear page so modal embeds its own report
      setCurrentPage(null);
    }
    setIsModalOpen(true);
  };

  // Handle report embedded callback - store report reference
  const handleReportLoaded = (report: Report, page: Page | null) => {
    console.log('Report embedded in App, storing report reference');
    setCurrentReport(report);
    // Don't set page here - we'll get it dynamically when opening modal
    if (page) {
      setCurrentPage(page);
    }
  };

  // Handle visual created callback to refresh the page
  const handleVisualCreated = async () => {
    console.log('Visual created, refreshing...');
    // Optionally refresh the report to show the new visual
    if (currentReport) {
      try {
        await currentReport.refresh();
      } catch (error) {
        console.warn('Could not refresh report:', error);
      }
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
        <div className="tab-controls" style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', gap: '0' }}>
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
        </div>

        {/* Visual selection controls - shown when Power BI Widgets tab is active */}
        {embedType === 'visual' && visualIds.length > 1 && (
          <div className="visual-controls" style={{ 
            marginTop: '15px', 
            display: 'flex', 
            gap: '15px', 
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
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
                Clear All Visuals
              </button>
              <label style={{ fontSize: '12px', color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input 
                  type="checkbox" 
                  checked={crossFilterEnabled} 
                  onChange={(e) => setCrossFilterEnabled(e.target.checked)}
                />
                Cross-filter
              </label>
            </div>
          </div>
        )}


      </header>
      <div className="App-content">
        <div className="report-section">
          {embedType === 'visual' ? (
            /* Render visual grid with placeholder */
            <div className="multi-visual-container">
              <div className="multi-visual-grid">
                {visualIds.map((visualId, index) => (
                  <div key={visualId} className="visual-container">
                    <PowerBIReport 
                      embedType="visual"
                      visualId={visualId}
                      pageName={pageName}
                      onDataSelected={crossFilterEnabled && visualIds.length > 1 ? handleVisualDataSelected : undefined}
                      onVisualRef={registerVisualRef}
                    />
                  </div>
                ))}
                {/* Placeholder tile for adding new visuals */}
                <div className="visual-placeholder" onClick={handleOpenModal}>
                  <div className="placeholder-content">
                    <div className="plus-icon">+</div>
                    <div className="placeholder-text">Add Visual</div>
                    <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>Select from report</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Render full report - edit mode enabled for visual authoring */
            <PowerBIReport 
              embedType={embedType}
              editMode={true}
              onReportLoaded={handleReportLoaded}
            />
          )}
        </div>
        <div className="chat-section">
          <AIChat />
        </div>
      </div>

      {/* Visual Creator Modal */}
      <VisualCreatorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreateVisual={handleCreateVisual}
        discoveredPages={discoveredPages}
        availableVisuals={availableVisuals}
        page={currentPage}
        onVisualCreated={handleVisualCreated}
      />
    </div>
  );
}

export default App;
