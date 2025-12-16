import React, { useState, useEffect, useRef } from 'react';
import { models, service, factories } from 'powerbi-client';
import { apiService } from '../../services/api';

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
  { name: 'columnChart', displayName: 'Column Chart', dataRoles: ['Category', 'Values'], icon: '📊' },
  { name: 'barChart', displayName: 'Bar Chart', dataRoles: ['Category', 'Values'], icon: '📈' },
  { name: 'lineChart', displayName: 'Line Chart', dataRoles: ['Category', 'Values'], icon: '📉' },
  { name: 'pieChart', displayName: 'Pie Chart', dataRoles: ['Category', 'Values'], icon: '🥧' },
  { name: 'card', displayName: 'Card', dataRoles: ['Values'], icon: '🃏' },
  { name: 'table', displayName: 'Table', dataRoles: ['Values'], icon: '📋' },
  { name: 'map', displayName: 'Map', dataRoles: ['Location', 'Values'], icon: '🗺️' },
];

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
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(true);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Power BI report for visual authoring
  useEffect(() => {
    initializeAuthoringReport();
    return () => {
      if (report) {
        try {
          report.off('loaded');
          report.off('error');
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
        permissions: models.Permissions.All,
        viewMode: models.ViewMode.Edit,
        settings: {
          panes: {
            filters: { visible: false, expanded: false },
            pageNavigation: { visible: false },
            visualizations: { visible: false, expanded: false },
            fields: { visible: false, expanded: false },
            bookmarks: { visible: false },
            syncSlicers: { visible: false },
            selection: { visible: false }
          },
          bars: {
            actionBar: { visible: false },
            statusBar: { visible: false }
          },
          background: models.BackgroundType.Transparent,
          layoutType: models.LayoutType.Custom,
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
      };

      const embeddedReport = powerbi.embed(previewContainerRef.current, embedConfig) as any;
      
      embeddedReport.on('loaded', async () => {
        console.log('Authoring report loaded');
        
        // Force update settings to hide all panes after load
        await embeddedReport.updateSettings({
          panes: {
            filters: { visible: false, expanded: false },
            pageNavigation: { visible: false },
            visualizations: { visible: false, expanded: false },
            fields: { visible: false, expanded: false },
            bookmarks: { visible: false },
            syncSlicers: { visible: false },
            selection: { visible: false }
          },
          bars: {
            actionBar: { visible: false },
            statusBar: { visible: false }
          }
        });
        
        const pages = await embeddedReport.getPages();
        if (pages && pages.length > 0) {
          let targetPage = pages.find((p: any) => p.displayName === 'visualCreation');
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

  const handleAuthorVisual = () => {
    // TODO: Implement visual creation logic
    console.log('Creating visual:', {
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
                <h3>Set your fields</h3>
                <div className="data-fields-wrapper">
                  {selectedVisualType.dataRoles.map((role) => (
                    <div key={role} className="field-row">
                      <label htmlFor={`field-${role}`} className="field-label">
                        {role}:
                      </label>
                      <select
                        id={`field-${role}`}
                        className="field-select"
                        value={dataFields[role] || ''}
                        onChange={(e) => setDataFields({ ...dataFields, [role]: e.target.value })}
                      >
                        <option value="">Select {role}</option>
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
