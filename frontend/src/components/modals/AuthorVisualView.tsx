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
          // Modify config for edit mode
          const editConfig = {
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
            },
            viewMode: models.ViewMode.Edit,
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
  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [showXAxis, setShowXAxis] = useState<boolean>(true);
  const [showYAxis, setShowYAxis] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);

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

  const resetForm = () => {
    setVisualType("");
    setDataFields({});
    setVisualTitle("");
    setShowLegend(true);
    setShowXAxis(true);
    setShowYAxis(true);
    setIsCreating(false);
  };

  const handleVisualTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || "";
    setVisualType(value);
    setDataFields({}); // Reset data fields when visual type changes
  };

  const handleDataFieldChange = (dataRole: string, value: string) => {
    setDataFields(prev => ({
      ...prev,
      [dataRole]: value
    }));
  };

  const canCreateVisual = (): boolean => {
    if (!visualType || !page) return false;
    
    // At least two data fields should be selected for most visuals
    const filledFields = Object.values(dataFields).filter(f => f).length;
    return filledFields >= 2;
  };

  // Convert property name to selector format required by Power BI API
  const propertyToSelector = (propertyName: string): any => {
    return {
      objectName: propertyName === "titleText" || propertyName === "title" ? "title" : propertyName,
      propertyName: propertyName === "titleText" ? "text" : propertyName
    };
  };

  const createVisual = async () => {
    if (!page || !visualType) return;

    setIsCreating(true);

    try {
      // Define visual layout
      const layout = {
        x: 50,
        y: 50,
        width: 400,
        height: 300,
        displayState: {
          mode: 0 // Visible
        }
      };

      // Create the visual using the authoring API
      // The powerbi-report-authoring import extends Page with createVisual method
      console.log("Creating visual:", visualType);
      const visualResponse = await (page as any).createVisual(visualType, layout);
      const visual = visualResponse.visual;

      // Add data fields
      for (const [dataRole, fieldName] of Object.entries(dataFields)) {
        if (fieldName) {
          try {
            // Look up the table and column from fieldMapping
            const fieldInfo = fieldMapping[fieldName];
            
            if (!fieldInfo) {
              console.error(`Field mapping not found for: ${fieldName}`);
              continue;
            }
            
            // Create data field target with proper typing
            const dataField: any = {
              [fieldInfo.isMeasure ? "measure" : "column"]: fieldInfo.column,
              table: fieldInfo.table,
            };
            
            await visual.addDataField(dataRole, dataField);
            console.log(`Added data field: ${dataRole} = ${fieldInfo.table}[${fieldInfo.column}]`);
          } catch (error) {
            console.error(`Error adding data field ${dataRole}:`, error);
          }
        }
      }

      // Set visual properties
      if (visualTitle) {
        try {
          await visual.setProperty(propertyToSelector("title"), {
            schema: schemas.property,
            value: true
          });
          await visual.setProperty(propertyToSelector("titleText"), {
            schema: schemas.property,
            value: visualTitle
          });
        } catch (error) {
          console.error("Error setting title:", error);
        }
      }

      // Set legend property (for visuals that support it)
      if (["pieChart", "lineChart", "areaChart", "donutChart"].includes(visualType)) {
        try {
          await visual.setProperty(propertyToSelector("legend"), {
            schema: schemas.property,
            value: showLegend
          });
        } catch (error) {
          console.error("Error setting legend:", error);
        }
      }

      // Set axis properties (for visuals that support them)
      if (["columnChart", "barChart", "lineChart", "areaChart"].includes(visualType)) {
        try {
          if (showXAxis !== undefined) {
            await visual.setProperty(propertyToSelector("xAxis"), {
              schema: schemas.property,
              value: showXAxis
            });
          }
          if (showYAxis !== undefined) {
            await visual.setProperty(propertyToSelector("yAxis"), {
              schema: schemas.property,
              value: showYAxis
            });
          }
        } catch (error) {
          console.error("Error setting axis properties:", error);
        }
      }

      console.log("Visual created successfully!");
      
      // Call callback if provided
      if (onVisualCreated) {
        onVisualCreated();
      }

      // Close modal
      handleClose();
    } catch (error) {
      console.error("Error creating visual:", error);
      alert("Failed to create visual. Please check the console for details. Make sure you have the powerbi-report-authoring library loaded and proper permissions.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      resetForm();
      onClose();
    }
  };

  const handleBack = () => {
    if (!isCreating) {
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
        <p className="section-description">Select the type of visual you want to create</p>
        <select 
          value={visualType} 
          onChange={handleVisualTypeChange}
          className="visual-type-select"
          disabled={isCreating || !page}
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
          <h3>Step 2: Set Data Fields</h3>
          <p className="section-description">Map your data fields to the visual's data roles</p>
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
          <p className="section-description">Customize the appearance of your visual</p>
          
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

      {/* Preview Section */}
      {visualType && Object.values(dataFields).filter(f => f).length >= 2 && (
        <div className="modal-section preview-section">
          <h3>Preview</h3>
          <div className="visual-preview-card">
            <div className="preview-icon">📊</div>
            <div className="preview-details">
              <strong>{visualTypes.find(v => v.name === visualType)?.displayName || visualType}</strong>
              {visualTitle && <p>Title: {visualTitle}</p>}
              <p>Data Fields: {Object.entries(dataFields).filter(([_, v]) => v).map(([role, field]) => `${role}: ${field}`).join(', ')}</p>
              <p className="preview-note">Click "Create Visual" to add this visual to your report</p>
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
          <button className="btn-cancel" onClick={handleClose} disabled={isCreating}>
            Cancel
          </button>
          <button 
            className="btn-create" 
            onClick={createVisual}
            disabled={!canCreateVisual() || isCreating}
          >
            {isCreating ? "Creating..." : "Create Visual"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorVisualView;
