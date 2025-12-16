import React, { useState, useEffect, useRef } from 'react';
import { Page, Report } from 'powerbi-client';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import 'powerbi-report-authoring'; // This extends Page with createVisual method
import { apiService } from '../../services/api';

// Note: The createVisual API requires:
// 1. powerbi-report-authoring library to be loaded (imported above)
// 2. Report must be embedded in EDIT mode with proper permissions
// 3. The Page object must come from an edit-mode embedded report
// 4. The report iframe must be VISIBLE (not hidden) for createVisual to work

// Define available visual types with their data roles
const visualTypes = [
  { name: "columnChart", displayName: "Column Chart", dataRoles: ["Category", "Y", "Tooltips"] },
  { name: "barChart", displayName: "Bar Chart", dataRoles: ["Category", "Y", "Tooltips"] },
  { name: "pieChart", displayName: "Pie Chart", dataRoles: ["Category", "Y", "Tooltips"] },
  { name: "lineChart", displayName: "Line Chart", dataRoles: ["Category", "Series", "Y"] },
  { name: "areaChart", displayName: "Area Chart", dataRoles: ["Category", "Series", "Y"] },
  { name: "donutChart", displayName: "Donut Chart", dataRoles: ["Category", "Y", "Tooltips"] },
];

// Schema constants for Power BI API
const schemas = {
  column: "http://powerbi.com/product/schema#column",
  measure: "http://powerbi.com/product/schema#measure",
  property: "http://powerbi.com/product/schema#property",
};

// Field mapping - maps display names to table and column information
// TODO: Update this with your actual Power BI data model table and column names
const fieldMapping: { [key: string]: { table: string; column: string; isMeasure?: boolean } } = {
  "Category": { table: "Category", column: "Category" },
  "Order Count": { table: "Mesures", column: "Count order", isMeasure: true }
};

interface AuthorVisualViewProps {
  onClose: () => void;
  onBack: () => void;
  page?: Page | null;
  onVisualCreated?: () => void;
}

const AuthorVisualView: React.FC<AuthorVisualViewProps> = ({
  onClose,
  onBack,
  page: externalPage,
  onVisualCreated,
}) => {
  const [visualType, setVisualType] = useState<string>("");
  const [dataFields, setDataFields] = useState<{ [key: string]: string }>({});
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [visualTitle, setVisualTitle] = useState<string>("");

  // Internal report state for when no external page is provided
  const [internalPage, setInternalPage] = useState<Page | null>(null);
  const [embedConfig, setEmbedConfig] = useState<any>(null);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(false);
  const embeddedReportRef = useRef<Report | null>(null);

  // Use external page if provided, otherwise use internal page
  const page = externalPage || internalPage;
  const needsEmbeddedReport = !externalPage;

  // Load embed config when we need to embed our own report
  useEffect(() => {
    const loadEmbedConfig = async () => {
      if (needsEmbeddedReport && !embedConfig) {
        setIsLoadingReport(true);
        try {
          const config = await apiService.getPowerBIConfig();
          // Modify config for edit mode with custom layout to fit visual to page
          const editConfig = {
            type: 'report',
            embedUrl: config.embedUrl,
            accessToken: config.accessToken,
            tokenType: models.TokenType.Embed,
            settings: {
              panes: {
                filters: { visible: false },
                pageNavigation: { visible: false },
                fields: { visible: false },
                visualizations: { visible: false },
              },
              bars: {
                actionBar: { visible: false },
                statusBar: { visible: false },
              },
              background: models.BackgroundType.Transparent,
              // Use custom layout with FitToPage to zoom the report to fit the visual
              layoutType: models.LayoutType.Custom,
              customLayout: {
                displayOption: models.DisplayOption.FitToPage,
              },
              // Hide visual headers (the ... menu on visuals)
              visualSettings: {
                visualHeaders: [
                  {
                    settings: {
                      visible: false
                    }
                  }
                ]
              }
            },
            // Use View mode - the createVisual API works in View mode and this hides the editing toolbar
            viewMode: models.ViewMode.View,
            permissions: models.Permissions.All,
          };
          setEmbedConfig(editConfig);
        } catch (error) {
          console.error('Error loading embed config for visual authoring:', error);
        } finally {
          setIsLoadingReport(false);
        }
      }
    };
    loadEmbedConfig();
  }, [needsEmbeddedReport, embedConfig]);

  // Store embedded report reference (called immediately when component mounts)
  const handleEmbeddedComponent = (report: Report) => {
    console.log('AuthorVisualView: Got embedded report reference');
    embeddedReportRef.current = report;
  };

  // Handle when report is fully rendered - now safe to get pages
  const handleReportRendered = async () => {
    console.log('AuthorVisualView: Report rendered, getting pages...');
    const report = embeddedReportRef.current;
    if (!report) {
      console.error('No report reference available');
      return;
    }
    
    // Get the active page
    try {
      const pages = await report.getPages();
      const activePage = pages.find(p => p.isActive) || pages[0];
      if (activePage) {
        console.log('AuthorVisualView: Got active page:', activePage.displayName);
        setInternalPage(activePage);
      }
    } catch (error) {
      console.error('Error getting active page:', error);
    }
  };

  // Debug: Log when page prop changes
  useEffect(() => {
    console.log('AuthorVisualView: page changed:', page ? 'Page available' : 'Page is null');
  }, [page]);

  // Live visual reference - stores the created visual for real-time updates
  const [liveVisual, setLiveVisual] = useState<any>(null);
  const liveVisualRef = useRef<any>(null); // Ref to avoid stale closures
  const isCreatingRef = useRef<boolean>(false); // Use ref to prevent race conditions
  const currentVisualTypeRef = useRef<string>(""); // Track what type we're creating

  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [showXAxis, setShowXAxis] = useState<boolean>(true);
  const [showYAxis, setShowYAxis] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Track previous data fields to detect changes
  const prevDataFieldsRef = useRef<{ [key: string]: string }>({});

  // Sync liveVisual state with ref
  useEffect(() => {
    liveVisualRef.current = liveVisual;
  }, [liveVisual]);

  // Get available data roles for selected visual type
  const getDataRoles = (): string[] => {
    if (!visualType) return [];
    const visual = visualTypes.find(v => v.name === visualType);
    return visual ? visual.dataRoles : [];
  };

  // Load available fields on mount
  useEffect(() => {
    loadAvailableFields();
  }, [page]);

  // Load available fields from the report
  const loadAvailableFields = async () => {
    if (!page) {
      // Use fallback fields from fieldMapping
      setAvailableFields(Object.keys(fieldMapping));
      return;
    }
    
    try {
      // Get visuals from page to extract available fields
      await page.getVisuals();
      
      // Load field names from the fieldMapping object
      const availableFieldNames = Object.keys(fieldMapping);
      setAvailableFields(availableFieldNames);
    } catch (error) {
      console.error("Error loading fields:", error);
      // Use fallback fields from fieldMapping
      setAvailableFields(Object.keys(fieldMapping));
    }
  };

  // CREATE VISUAL when visual type is selected
  useEffect(() => {
    // Skip if no page or no visual type selected
    if (!page || !visualType) return;
    
    // Skip if we already have a visual of this exact type
    if (liveVisualRef.current && currentVisualTypeRef.current === visualType) {
      return;
    }
    
    // Use an abort controller pattern to handle rapid changes
    let cancelled = false;
    
    const createLiveVisual = async () => {
      const targetVisualType = visualType; // Capture for async safety
      
      // Wait for any in-progress operation to finish
      while (isCreatingRef.current) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (cancelled) return;
      }
      
      // Double-check we still want this visual type
      if (cancelled || currentVisualTypeRef.current === targetVisualType) {
        return;
      }
      
      isCreatingRef.current = true;
      
      // Delete previous visual if exists using page.deleteVisual (like the demo does)
      const existingVisual = liveVisualRef.current;
      if (existingVisual && existingVisual.name) {
        console.log('Deleting previous visual using page.deleteVisual:', existingVisual.name);
        setLiveVisual(null);
        liveVisualRef.current = null;
        currentVisualTypeRef.current = ""; // Clear so we don't skip
        try {
          // Use page.deleteVisual instead of visual.delete() - this is what the demo uses
          await (page as any).deleteVisual(existingVisual.name);
          console.log('Previous visual deleted successfully');
        } catch (error) {
          console.error('Error deleting previous visual:', error);
        }
        // Small delay to ensure Power BI processes the deletion
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Check if cancelled while we were deleting
      if (cancelled) {
        isCreatingRef.current = false;
        return;
      }
      
      try {
        // Layout to fill the page - use large dimensions like the quick-create-visuals demo
        // The visual will be scaled to fit with FitToPage display option
        const layout = {
          x: 20,
          y: 20,
          width: 1240,
          height: 680,
          displayState: { mode: 0 }
        };

        console.log('Creating live visual:', targetVisualType);
        const visualResponse = await (page as any).createVisual(targetVisualType, layout);
        const visual = visualResponse.visual;
        
        // Only keep if not cancelled
        if (!cancelled) {
          setLiveVisual(visual);
          liveVisualRef.current = visual;
          currentVisualTypeRef.current = targetVisualType;
          console.log('Live visual created successfully:', targetVisualType, 'name:', visual.name);
          
          // Format visual properties for better readability (like quick-create-visuals demo)
          try {
            // Set larger title font size (demo uses 25)
            await visual.setProperty(
              { objectName: "title", propertyName: "textSize" },
              { schema: schemas.property, value: 25 }
            );
            // Set title color to black for better contrast
            await visual.setProperty(
              { objectName: "title", propertyName: "fontColor" },
              { schema: schemas.property, value: "#000000" }
            );
            
            // Set larger X-axis (category axis) font sizes
            await visual.setProperty(
              { objectName: "categoryAxis", propertyName: "fontSize" },
              { schema: schemas.property, value: 32 }
            );
            await visual.setProperty(
              { objectName: "categoryAxis", propertyName: "titleFontSize" },
              { schema: schemas.property, value: 32 }
            );
            await visual.setProperty(
              { objectName: "categoryAxis", propertyName: "labelDisplayUnits" },
              { schema: schemas.property, value: 32 }
            );
            
            // Set larger Y-axis (value axis) font sizes
            await visual.setProperty(
              { objectName: "valueAxis", propertyName: "fontSize" },
              { schema: schemas.property, value: 32 }
            );
            await visual.setProperty(
              { objectName: "valueAxis", propertyName: "titleFontSize" },
              { schema: schemas.property, value: 16 }
            );
            await visual.setProperty(
              { objectName: "valueAxis", propertyName: "labelDisplayUnits" },
              { schema: schemas.property, value: 32 }
            );
            
            // Set larger data label font size
            await visual.setProperty(
              { objectName: "labels", propertyName: "fontSize" },
              { schema: schemas.property, value: 32 }
            );
            
            // Set larger legend font size
            await visual.setProperty(
              { objectName: "legend", propertyName: "fontSize" },
              { schema: schemas.property, value: 32 }
            );
            
            // Enable legend for pie charts (disabled by default)
            if (targetVisualType === "pieChart" || targetVisualType === "donutChart") {
              await visual.setProperty(
                { objectName: "legend", propertyName: "visible" },
                { schema: schemas.property, value: true }
              );
              // Set larger detail labels for pie/donut charts
              await visual.setProperty(
                { objectName: "labels", propertyName: "labelStyle" },
                { schema: schemas.property, value: "Both" }
              );
            }
          } catch (propError) {
            console.log('Some visual properties could not be set:', propError);
          }
          
          // Hide visual headers on the new visual (like the demo does)
          const report = embeddedReportRef.current;
          if (report) {
            try {
              await report.updateSettings({
                visualSettings: {
                  visualHeaders: [
                    {
                      settings: {
                        visible: false
                      }
                    }
                  ]
                }
              });
            } catch (e) {
              console.error('Error hiding visual headers:', e);
            }
          }
          
          // Reset data fields when creating new visual
          setDataFields({});
          prevDataFieldsRef.current = {};
        } else {
          // Was cancelled, delete this visual using page.deleteVisual
          console.log('Creation was cancelled, cleaning up...');
          try {
            await (page as any).deleteVisual(visual.name);
          } catch (e) {
            console.error('Error cleaning up cancelled visual:', e);
          }
        }
      } catch (error) {
        console.error('Error creating live visual:', error);
      } finally {
        isCreatingRef.current = false;
      }
    };

    createLiveVisual();
    
    // Cleanup function - cancels this effect if visual type changes
    return () => {
      cancelled = true;
    };
  }, [visualType, page]);

  // UPDATE DATA FIELDS in real-time when they change
  useEffect(() => {
    const updateDataFields = async () => {
      if (!liveVisual) return;

      const prevFields = prevDataFieldsRef.current;
      
      for (const [dataRole, fieldName] of Object.entries(dataFields)) {
        const prevFieldName = prevFields[dataRole];
        
        // Skip if no change
        if (fieldName === prevFieldName) continue;
        
        try {
          // If there was a previous field, we need to remove it first
          // Note: The API doesn't have a direct "remove" - we'll just add the new one
          
          if (fieldName) {
            const fieldInfo = fieldMapping[fieldName];
            if (!fieldInfo) {
              console.error(`Field mapping not found for: ${fieldName}`);
              continue;
            }
            
            const dataField: any = {
              [fieldInfo.isMeasure ? "measure" : "column"]: fieldInfo.column,
              table: fieldInfo.table,
            };
            
            await liveVisual.addDataField(dataRole, dataField);
            console.log(`Live update - Added data field: ${dataRole} = ${fieldInfo.table}[${fieldInfo.column}]`);
          }
        } catch (error) {
          console.error(`Error updating data field ${dataRole}:`, error);
        }
      }
      
      // Update the previous fields reference
      prevDataFieldsRef.current = { ...dataFields };
    };

    updateDataFields();
  }, [dataFields, liveVisual]);

  // UPDATE TITLE in real-time
  useEffect(() => {
    const updateTitle = async () => {
      if (!liveVisual) return;
      
      try {
        if (visualTitle) {
          await liveVisual.setProperty(propertyToSelector("title"), {
            schema: schemas.property,
            value: true
          });
          await liveVisual.setProperty(propertyToSelector("titleText"), {
            schema: schemas.property,
            value: visualTitle
          });
        } else {
          await liveVisual.setProperty(propertyToSelector("title"), {
            schema: schemas.property,
            value: false
          });
        }
      } catch (error) {
        console.error('Error updating title:', error);
      }
    };

    // Debounce title updates
    const timeoutId = setTimeout(updateTitle, 300);
    return () => clearTimeout(timeoutId);
  }, [visualTitle, liveVisual]);

  // UPDATE LEGEND in real-time
  useEffect(() => {
    const updateLegend = async () => {
      if (!liveVisual || !["pieChart", "lineChart", "areaChart", "donutChart"].includes(visualType)) return;
      
      try {
        await liveVisual.setProperty(propertyToSelector("legend"), {
          schema: schemas.property,
          value: showLegend
        });
      } catch (error) {
        console.error('Error updating legend:', error);
      }
    };

    updateLegend();
  }, [showLegend, liveVisual, visualType]);

  // UPDATE AXES in real-time
  useEffect(() => {
    const updateAxes = async () => {
      if (!liveVisual || !["columnChart", "barChart", "lineChart", "areaChart"].includes(visualType)) return;
      
      try {
        await liveVisual.setProperty(propertyToSelector("xAxis"), {
          schema: schemas.property,
          value: showXAxis
        });
        await liveVisual.setProperty(propertyToSelector("yAxis"), {
          schema: schemas.property,
          value: showYAxis
        });
      } catch (error) {
        console.error('Error updating axes:', error);
      }
    };

    updateAxes();
  }, [showXAxis, showYAxis, liveVisual, visualType]);

  // Clean up visual when component unmounts or modal closes
  const cleanupVisual = async () => {
    const visual = liveVisualRef.current;
    if (visual && visual.name && page) {
      try {
        // Use page.deleteVisual like the demo does
        await (page as any).deleteVisual(visual.name);
        console.log('Cleaned up live visual:', visual.name);
      } catch (error) {
        console.error('Error cleaning up visual:', error);
      }
    }
  };

  const resetForm = () => {
    setVisualType("");
    setDataFields({});
    setVisualTitle("");
    setShowLegend(true);
    setShowXAxis(true);
    setShowYAxis(true);
    setIsCreating(false);
    setLiveVisual(null);
    prevDataFieldsRef.current = {};
  };

  const handleVisualTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || "";
    setVisualType(value);
    // Data fields will be reset in the useEffect that creates the visual
  };

  const handleDataFieldChange = (dataRole: string, value: string) => {
    setDataFields(prev => ({
      ...prev,
      [dataRole]: value
    }));
  };

  const canCreateVisual = (): boolean => {
    // Visual is already created live, so we just need to check if it exists
    return !!liveVisual;
  };

  // Convert property name to selector format required by Power BI API
  const propertyToSelector = (propertyName: string): any => {
    return {
      objectName: propertyName === "titleText" || propertyName === "title" ? "title" : propertyName,
      propertyName: propertyName === "titleText" ? "text" : propertyName
    };
  };

  // "Keep Visual" - just close modal without deleting the visual
  const keepVisual = async () => {
    console.log("Keeping visual on page");
    
    // Call callback if provided
    if (onVisualCreated) {
      onVisualCreated();
    }

    // Clear the live visual ref so it doesn't get deleted
    setLiveVisual(null);
    
    // Close modal
    resetForm();
    onClose();
  };

  // "Cancel" - delete the visual and close
  const handleClose = async () => {
    if (!isCreating && !isCreatingRef.current) {
      await cleanupVisual();
      resetForm();
      onClose();
    }
  };

  // "Back" - delete the visual and go back
  const handleBack = async () => {
    if (!isCreating && !isCreatingRef.current) {
      await cleanupVisual();
      resetForm();
      onBack();
    }
  };

  const dataRoles = getDataRoles();

  // Render the authoring controls
  const renderAuthoringControls = () => (
    <div className="authoring-controls">
      {/* Visual Type Selection */}
      <div className="modal-section">
        <h3>Step 1: Choose Visual Type</h3>
        <p className="section-description">Select a visual type - it will appear on the report immediately</p>
        <select 
          value={visualType} 
          onChange={handleVisualTypeChange}
          className="visual-type-select"
          disabled={!page}
        >
          <option value="">Select a visual type...</option>
          {visualTypes.map(vt => (
            <option key={vt.name} value={vt.name}>
              {vt.displayName}
            </option>
          ))}
        </select>
      </div>

      {/* Data Fields Section */}
      {visualType && (
        <div className="modal-section">
          <h3>Step 2: Add Data Fields</h3>
          <p className="section-description">Select fields - changes update the visual live</p>
          <div className="data-fields-grid">
            {dataRoles.map(role => (
              <div key={role} className="field-row">
                <label className="field-label">{role}</label>
                <select
                  value={dataFields[role] || ""}
                  onChange={(e) => handleDataFieldChange(role, e.target.value)}
                  className="field-select"
                  disabled={isCreating}
                >
                  <option value="">Select a field...</option>
                  {availableFields.map(field => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format Visual Section */}
      {visualType && (
        <div className="modal-section">
          <h3>Step 3: Format Visual</h3>
          <p className="section-description">Adjust formatting - updates apply instantly</p>
          
          <div className="field-row">
            <label className="field-label">Visual Title (optional)</label>
            <input
              type="text"
              value={visualTitle}
              onChange={(e) => setVisualTitle(e.target.value)}
              placeholder="Enter visual title"
              className="visual-id-input"
              disabled={isCreating}
            />
          </div>

          <div className="checkbox-group">
            {["pieChart", "lineChart", "areaChart", "donutChart"].includes(visualType) && (
              <div className="checkbox-row">
                <label>
                  <input 
                    type="checkbox"
                    checked={showLegend}
                    onChange={(e) => setShowLegend(e.target.checked)}
                    disabled={isCreating}
                  />
                  {' '}Show Legend
                </label>
              </div>
            )}

            {["columnChart", "barChart", "lineChart", "areaChart"].includes(visualType) && (
              <>
                <div className="checkbox-row">
                  <label>
                    <input 
                      type="checkbox"
                      checked={showXAxis}
                      onChange={(e) => setShowXAxis(e.target.checked)}
                      disabled={isCreating}
                    />
                    {' '}Show X Axis
                  </label>
                </div>
                <div className="checkbox-row">
                  <label>
                    <input 
                      type="checkbox"
                      checked={showYAxis}
                      onChange={(e) => setShowYAxis(e.target.checked)}
                      disabled={isCreating}
                    />
                    {' '}Show Y Axis
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Status Section */}
      {liveVisual && (
        <div className="modal-section preview-section">
          <h3>✅ Visual Active</h3>
          <div className="visual-preview-card">
            <div className="preview-icon">📊</div>
            <div className="preview-details">
              <strong>{visualTypes.find(v => v.name === visualType)?.displayName || visualType}</strong>
              {visualTitle && <p>Title: {visualTitle}</p>}
              {Object.values(dataFields).filter(f => f).length > 0 && (
                <p>Data Fields: {Object.entries(dataFields).filter(([_, v]) => v).map(([role, field]) => `${role}: ${field}`).join(', ')}</p>
              )}
              <p className="preview-note">Your visual is live on the report. Click "Keep Visual" to save it.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className={`modal-container ${needsEmbeddedReport ? 'modal-container-split' : 'modal-container-large'}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button 
            className="back-button" 
            onClick={handleBack}
            disabled={isCreating}
            aria-label="Back to options"
          >
            ← Back
          </button>
          <h2>Author Visual</h2>
          <button 
            className="close-button" 
            onClick={handleClose} 
            disabled={isCreating}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={`modal-body ${needsEmbeddedReport ? 'modal-body-split' : ''}`}>
          {/* If we need embedded report, show split layout */}
          {needsEmbeddedReport && (
            <div className="embedded-report-pane">
              <div className="report-pane-header">
                <span>📊 Live Report Preview</span>
                {isLoadingReport && <span className="loading-indicator">Loading...</span>}
              </div>
              <div className="embedded-report-container">
                {embedConfig ? (
                  <PowerBIEmbed
                    embedConfig={embedConfig}
                    eventHandlers={new Map([
                      ['loaded', () => console.log('Report loaded in AuthorVisualView')],
                      ['rendered', handleReportRendered],
                      ['error', (event: any) => console.error('Report error:', event?.detail)]
                    ])}
                    cssClassName="author-visual-report"
                    getEmbeddedComponent={(embeddedReport) => handleEmbeddedComponent(embeddedReport as Report)}
                  />
                ) : (
                  <div className="report-loading-placeholder">
                    <div className="spinner"></div>
                    <p>Loading report for visual authoring...</p>
                  </div>
                )}
              </div>
              <p className="report-hint">New visuals will be created on this page</p>
            </div>
          )}

          {/* Authoring controls pane */}
          <div className={`authoring-pane ${needsEmbeddedReport ? 'authoring-pane-side' : ''}`}>
            {/* Loading state when waiting for page */}
            {needsEmbeddedReport && !page && !isLoadingReport && embedConfig && (
              <div className="waiting-banner">
                <span className="waiting-icon">⏳</span>
                <span>Waiting for report to load...</span>
              </div>
            )}

            {/* Show controls when page is ready OR when external page is provided */}
            {(page || !needsEmbeddedReport) && renderAuthoringControls()}

            {/* Warning if no page available and not loading */}
            {!page && !needsEmbeddedReport && (
              <div className="warning-banner">
                <span className="warning-icon">⚠️</span>
                <span>No report page available. Please embed a report first to create visuals.</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={handleClose}>
            {liveVisual ? 'Cancel & Delete Visual' : 'Cancel'}
          </button>
          <button 
            className="btn-create" 
            onClick={keepVisual}
            disabled={!liveVisual}
          >
            ✓ Keep Visual
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorVisualView;
