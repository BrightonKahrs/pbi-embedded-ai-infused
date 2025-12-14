import React, { useState, useEffect, useRef } from 'react';
import { models, service, factories } from 'powerbi-client';
import { apiService } from '../../services/api';

/**
 * AuthorVisualView - Live Visual Creation Component
 * 
 * This component implements Power BI's visual authoring capability, allowing users to:
 * 1. Select a visual type (column, bar, line, pie, card, table)
 * 2. Configure data fields by mapping them to visual data roles
 * 3. Customize visual properties (title, legend, axes)
 * 4. See the visual update in real-time as they make changes
 * 
 * Implementation based on Microsoft's PowerBI-Embedded-Showcases:
 * - Uses Power BI's createVisual API for live visual creation
 * - Implements addDataField/removeDataField for data binding
 * - Uses setProperty API for visual formatting
 * - Requires Edit permissions and ViewMode.Edit on the report
 * 
 * The visual is created in an embedded Power BI report in edit mode,
 * showing a live preview as the user configures it.
 */

interface VisualType {
  name: string;
  displayName: string;
  dataRoles: string[];
  icon: string;
}

interface AuthorVisualViewProps {
  onClose: () => void;
  onBack: () => void;
}

const VISUAL_TYPES: VisualType[] = [
  { name: 'columnChart', displayName: 'Column Chart', dataRoles: ['Category', 'Y'], icon: '📊' },
  { name: 'barChart', displayName: 'Bar Chart', dataRoles: ['Category', 'Y'], icon: '📈' },
  { name: 'lineChart', displayName: 'Line Chart', dataRoles: ['Category', 'Y'], icon: '📉' },
  { name: 'pieChart', displayName: 'Pie Chart', dataRoles: ['Category', 'Y'], icon: '🥧' },
  { name: 'card', displayName: 'Card', dataRoles: ['Y'], icon: '🃏' },
  { name: 'table', displayName: 'Table', dataRoles: ['Values'], icon: '📋' },
];

// Data field mapping - these would come from your actual report data model
const DATA_FIELD_TARGETS: any = {
  'Sales': { table: 'Sales', column: 'TotalSales' },
  'Revenue': { table: 'Sales', column: 'Revenue' },
  'Quantity': { table: 'Sales', column: 'Quantity' },
  'Product': { table: 'Products', column: 'ProductName' },
  'Category': { table: 'Products', column: 'Category' },
  'Date': { table: 'Calendar', column: 'Date' },
  'Region': { table: 'Geography', column: 'Region' },
};

// Property schemas for Power BI
const SCHEMAS = {
  column: 'http://powerbi.com/product/schema#column',
  measure: 'http://powerbi.com/product/schema#measure',
  property: 'http://powerbi.com/product/schema#property',
};

const AuthorVisualView: React.FC<AuthorVisualViewProps> = ({ onClose, onBack }) => {
  const [selectedVisualType, setSelectedVisualType] = useState<VisualType | null>(null);
  const [dataFields, setDataFields] = useState<{ [key: string]: string }>({});
  const [visualProperties, setVisualProperties] = useState({
    title: true,
    legend: true,
    xAxis: true,
    yAxis: true,
  });
  const [visualTitle, setVisualTitle] = useState<string>('');
  const [titleAlignment, setTitleAlignment] = useState<'left' | 'center' | 'right'>('left');
  
  // Power BI authoring state
  const [report, setReport] = useState<any>(null);
  const [page, setPage] = useState<any>(null);
  const [createdVisual, setCreatedVisual] = useState<any>(null);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(true);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Power BI report for visual authoring
  useEffect(() => {
    initializeAuthoringReport();
    return () => {
      // Cleanup on unmount
      if (report) {
        try {
          report.off('loaded');
        } catch (err) {
          console.error('Error cleaning up report:', err);
        }
      }
    };
  }, []);

  const initializeAuthoringReport = async () => {
    try {
      setIsLoadingReport(true);
      const config = await apiService.getPowerBIConfig();
      
      if (!previewContainerRef.current) return;

      const powerbi = new service.Service(
        factories.hpmFactory,
        factories.wpmpFactory,
        factories.routerFactory
      );

      const embedConfig: models.IReportEmbedConfiguration = {
        type: 'report',
        embedUrl: config.embedUrl,
        accessToken: config.accessToken,
        tokenType: models.TokenType.Embed,
        permissions: models.Permissions.All, // Need edit permissions for authoring
        viewMode: models.ViewMode.Edit, // Edit mode for creating visuals
        settings: {
          panes: {
            filters: { visible: false },
            pageNavigation: { visible: false },
          },
          background: models.BackgroundType.Transparent,
          layoutType: models.LayoutType.Custom,
          visualSettings: {
            visualHeaders: [
              {
                settings: {
                  visible: false // Hide visual headers in authoring mode
                }
              }
            ]
          }
        },
      };

      const embeddedReport = powerbi.embed(previewContainerRef.current, embedConfig) as any;
      
      embeddedReport.on('loaded', async () => {
        console.log('Authoring report loaded');
        const pages = await embeddedReport.getPages();
        if (pages && pages.length > 0) {
          // Try to find "Page 1" first, otherwise use first page
          let targetPage = pages.find((p: any) => p.displayName === 'Page 1');
          if (!targetPage) {
            targetPage = pages[0];
          }
          await targetPage.setActive();
          setReport(embeddedReport);
          setPage(targetPage);
          setIsLoadingReport(false);
        }
      });

      embeddedReport.on('error', (event: any) => {
        console.error('Report error:', event.detail);
        setIsLoadingReport(false);
      });

    } catch (error) {
      console.error('Failed to initialize authoring report:', error);
      setIsLoadingReport(false);
    }
  };

  // Create or update visual when type or data fields change
  useEffect(() => {
    if (selectedVisualType && page && !isLoadingReport) {
      createOrUpdateVisual();
    }
  }, [selectedVisualType, page, isLoadingReport]);

  // Update visual data when fields change
  useEffect(() => {
    if (createdVisual && Object.keys(dataFields).length > 0) {
      updateVisualData();
    }
  }, [dataFields, createdVisual]);

  // Update visual properties when they change
  useEffect(() => {
    if (createdVisual) {
      updateVisualProperties();
    }
  }, [visualProperties, visualTitle, titleAlignment, createdVisual]);

  const createOrUpdateVisual = async () => {
    if (!page || !selectedVisualType) return;

    try {
      // Delete existing visual if changing type
      if (createdVisual) {
        await page.deleteVisual(createdVisual.name);
        setCreatedVisual(null);
      }

      // Get container dimensions for proper sizing
      const containerWidth = previewContainerRef.current?.offsetWidth || 1240;
      const containerHeight = previewContainerRef.current?.offsetHeight || 680;
      
      // Create new visual with layout (matches Microsoft showcase sizing)
      const layout = {
        x: (0.1 * containerWidth) / 2,
        y: (0.2 * containerHeight) / 2,
        width: containerWidth * 0.9,
        height: containerHeight * 0.85,
        displayState: {
          mode: models.VisualContainerDisplayMode.Visible,
        },
      };

      const newVisualResponse = await page.createVisual(selectedVisualType.name, layout);
      const visual = newVisualResponse.visual;
      
      console.log('Visual created:', visual);
      setCreatedVisual(visual);

      // Set initial properties (matches Microsoft showcase)
      await setVisualProperty(visual, 'titleSize', 25);
      await setVisualProperty(visual, 'titleColor', '#000000');
      
      // Enable legend for pie chart by default
      if (selectedVisualType.name === 'pieChart') {
        await setVisualProperty(visual, 'legend', true);
      }

    } catch (error) {
      console.error('Error creating visual:', error);
    }
  };

  const updateVisualData = async () => {
    if (!createdVisual || !selectedVisualType) return;

    try {
      // Get visual capabilities to map display names to data role names
      const capabilities = await createdVisual.getCapabilities();
      
      // Add data fields to the visual
      for (const [roleDisplayName, fieldName] of Object.entries(dataFields)) {
        if (fieldName && DATA_FIELD_TARGETS[fieldName]) {
          const target = DATA_FIELD_TARGETS[fieldName];
          
          // Find the actual data role name from display name
          const dataRole = capabilities.dataRoles.find(
            (dr: any) => dr.displayName === roleDisplayName
          );
          
          if (!dataRole) continue;
          const dataRoleName = dataRole.name;
          
          // Remove existing data field first
          try {
            const existingFields = await createdVisual.getDataFields(dataRoleName);
            if (existingFields && existingFields.length > 0) {
              await createdVisual.removeDataField(dataRoleName, 0);
            }
          } catch (err) {
            // Field doesn't exist yet, that's ok
          }

          // Add new data field with proper schema
          await createdVisual.addDataField(dataRoleName, {
            column: target.column,
            table: target.table,
          });
        }
      }
    } catch (error) {
      console.error('Error updating visual data:', error);
    }
  };

  const updateVisualProperties = async () => {
    if (!createdVisual) return;

    try {
      // Update title visibility
      await setVisualProperty(createdVisual, 'title', visualProperties.title);
      
      // Update title text if provided
      if (visualProperties.title && visualTitle) {
        await setVisualProperty(createdVisual, 'titleText', visualTitle);
      } else if (visualProperties.title && !visualTitle) {
        await createdVisual.resetProperty(propertyToSelector('titleText'));
      }
      
      // Update title alignment
      if (visualProperties.title) {
        await setVisualProperty(createdVisual, 'titleAlign', titleAlignment);
      }
      
      // Update legend (for charts)
      if (selectedVisualType && selectedVisualType.name !== 'card' && selectedVisualType.name !== 'table') {
        await setVisualProperty(createdVisual, 'legend', visualProperties.legend);
      }
      
      // Update axes (for column, bar, line charts)
      if (selectedVisualType && ['columnChart', 'barChart', 'lineChart'].includes(selectedVisualType.name)) {
        await setVisualProperty(createdVisual, 'xAxis', visualProperties.xAxis);
        await setVisualProperty(createdVisual, 'yAxis', visualProperties.yAxis);
      }
    } catch (error) {
      console.error('Error updating visual properties:', error);
    }
  };

  const setVisualProperty = async (visual: any, propertyName: string, value: any) => {
    try {
      const selector = propertyToSelector(propertyName);
      await visual.setProperty(selector, { schema: SCHEMAS.property, value });
    } catch (error) {
      console.error(`Error setting property ${propertyName}:`, error);
    }
  };

  const propertyToSelector = (propertyName: string) => {
    const selectorMap: any = {
      title: { objectName: 'title', propertyName: 'visible' },
      xAxis: { objectName: 'categoryAxis', propertyName: 'visible' },
      yAxis: { objectName: 'valueAxis', propertyName: 'visible' },
      legend: { objectName: 'legend', propertyName: 'visible' },
      titleText: { objectName: 'title', propertyName: 'titleText' },
      titleAlign: { objectName: 'title', propertyName: 'alignment' },
      titleSize: { objectName: 'title', propertyName: 'textSize' },
      titleColor: { objectName: 'title', propertyName: 'fontColor' },
    };
    return selectorMap[propertyName];
  };

  const handleAuthorVisual = () => {
    console.log('Visual created successfully:', {
      type: selectedVisualType,
      dataFields,
      properties: visualProperties,
      title: visualTitle,
      titleAlignment,
    });
    onClose();
  };

  const isAuthorDisabled = !selectedVisualType || Object.keys(dataFields).length === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container modal-container-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button 
            className="back-button" 
            onClick={onBack}
            aria-label="Back to options"
          >
            ← Back
          </button>
          <h2>Author Visual</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body author-body">
          <div className="author-controls">
            {/* Visual Type Selection */}
            <div className="modal-section">
              <h3>Choose the visual type</h3>
              <div className="visual-type-grid">
                {VISUAL_TYPES.map((visualType) => (
                  <button
                    key={visualType.name}
                    className={`visual-type-card ${selectedVisualType?.name === visualType.name ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedVisualType(visualType);
                      setDataFields({});
                    }}
                  >
                    <div className="visual-type-icon">{visualType.icon}</div>
                    <div className="visual-type-name">{visualType.displayName}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Data Fields Section */}
            {selectedVisualType && (
              <div className="modal-section">
                <h3>Set your data fields</h3>
                <div className="data-fields-wrapper">
                  {selectedVisualType.dataRoles.map((role) => (
                    <div key={role} className="field-row">
                      <label className="field-label">{role}</label>
                      <select
                        className="field-select"
                        value={dataFields[role] || ''}
                        onChange={(e) => setDataFields({ ...dataFields, [role]: e.target.value })}
                      >
                        <option value="">Select a field...</option>
                        <option value="Sales">Sales</option>
                        <option value="Revenue">Revenue</option>
                        <option value="Quantity">Quantity</option>
                        <option value="Product">Product</option>
                        <option value="Category">Category</option>
                        <option value="Date">Date</option>
                        <option value="Region">Region</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Properties Section */}
            {selectedVisualType && Object.keys(dataFields).length > 0 && (
              <div className="modal-section">
                <h3>Format your visual</h3>
                <div className="properties-wrapper">
                  {/* Title Toggle */}
                  <div className="property-row">
                    <span className="property-label">Title</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={visualProperties.title}
                        onChange={(e) => setVisualProperties({ ...visualProperties, title: e.target.checked })}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  {/* Title Text Input */}
                  {visualProperties.title && (
                    <div className="property-row property-indent">
                      <input
                        type="text"
                        className="title-input"
                        placeholder="Enter visual title"
                        value={visualTitle}
                        onChange={(e) => setVisualTitle(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Title Alignment */}
                  {visualProperties.title && (
                    <div className="property-row property-indent">
                      <span className="property-label-small">Title alignment</span>
                      <div className="alignment-buttons">
                        <button
                          className={`align-btn ${titleAlignment === 'left' ? 'selected' : ''}`}
                          onClick={() => setTitleAlignment('left')}
                          aria-label="Align left"
                        >
                          ⬅️
                        </button>
                        <button
                          className={`align-btn ${titleAlignment === 'center' ? 'selected' : ''}`}
                          onClick={() => setTitleAlignment('center')}
                          aria-label="Align center"
                        >
                          ↔️
                        </button>
                        <button
                          className={`align-btn ${titleAlignment === 'right' ? 'selected' : ''}`}
                          onClick={() => setTitleAlignment('right')}
                          aria-label="Align right"
                        >
                          ➡️
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Legend Toggle */}
                  {selectedVisualType.name !== 'card' && selectedVisualType.name !== 'table' && (
                    <div className="property-row">
                      <span className="property-label">Legend</span>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={visualProperties.legend}
                          onChange={(e) => setVisualProperties({ ...visualProperties, legend: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  )}

                  {/* X Axis Toggle */}
                  {(selectedVisualType.name === 'columnChart' || 
                    selectedVisualType.name === 'barChart' || 
                    selectedVisualType.name === 'lineChart') && (
                    <div className="property-row">
                      <span className="property-label">Category Axis</span>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={visualProperties.xAxis}
                          onChange={(e) => setVisualProperties({ ...visualProperties, xAxis: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  )}

                  {/* Y Axis Toggle */}
                  {(selectedVisualType.name === 'columnChart' || 
                    selectedVisualType.name === 'barChart' || 
                    selectedVisualType.name === 'lineChart') && (
                    <div className="property-row">
                      <span className="property-label">Value Axis</span>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={visualProperties.yAxis}
                          onChange={(e) => setVisualProperties({ ...visualProperties, yAxis: e.target.checked })}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Visual Preview Area */}
          <div className="visual-preview-area">
            <h3>Visual Preview</h3>
            {isLoadingReport && (
              <div className="preview-placeholder">
                <div className="preview-icon-large">⏳</div>
                <p>Loading authoring environment...</p>
              </div>
            )}
            {!isLoadingReport && !selectedVisualType && (
              <div className="preview-placeholder">
                <div className="preview-icon-large">✏️</div>
                <p>Select a visual type to begin</p>
              </div>
            )}
            <div 
              ref={previewContainerRef} 
              className="powerbi-authoring-container"
              style={{ 
                width: '100%', 
                height: '500px',
                display: selectedVisualType ? 'block' : 'none'
              }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="btn-create" 
            onClick={handleAuthorVisual}
            disabled={isAuthorDisabled}
          >
            Create Visual
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorVisualView;
