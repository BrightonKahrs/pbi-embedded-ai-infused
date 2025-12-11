import React, { useState, useEffect } from 'react';
import './VisualCreatorModal.css';

interface VisualType {
  name: string;
  displayName: string;
  dataRoles: string[];
  icon: string;
}

interface VisualCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateVisual: (visualId: string, pageName: string) => void;
  discoveredPages: any[];
  availableVisuals: any[];
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

const VisualCreatorModal: React.FC<VisualCreatorModalProps> = ({
  isOpen,
  onClose,
  onCreateVisual,
  discoveredPages,
  availableVisuals
}) => {
  const [selectedPage, setSelectedPage] = useState<string>('');
  const [selectedVisualId, setSelectedVisualId] = useState<string>('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPage('');
      setSelectedVisualId('');
    }
  }, [isOpen]);

  const handleCreateVisual = () => {
    if (selectedVisualId && selectedPage) {
      onCreateVisual(selectedVisualId, selectedPage);
      onClose();
    }
  };

  const isCreateDisabled = !selectedVisualId || !selectedPage;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Visual to Canvas</h2>
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
              <h3>Step 2: Enter Visual ID</h3>
              <p className="section-description">
                Enter the Visual ID or Name from the selected page
              </p>
              <div className="input-field-wrapper">
                <label htmlFor="visual-id-input" className="input-label">
                  Visual ID:
                </label>
                <input
                  id="visual-id-input"
                  type="text"
                  className="visual-id-input"
                  placeholder="e.g., visual1, chart2, table5"
                  value={selectedVisualId}
                  onChange={(e) => setSelectedVisualId(e.target.value.trim())}
                  autoFocus
                />
                <p className="input-help">
                  💡 Tip: Visual IDs are typically found in the Power BI report properties
                </p>
              </div>
            </div>
          )}

          {selectedVisualId && selectedPage && (
            <div className="modal-section preview-section">
              <h3>Preview</h3>
              <div className="visual-preview-card">
                <div className="preview-icon">📊</div>
                <div className="preview-details">
                  <strong>Visual ID: {selectedVisualId}</strong>
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

export default VisualCreatorModal;
