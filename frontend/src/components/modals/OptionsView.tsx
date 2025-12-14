import React from 'react';

interface OptionsViewProps {
  onClose: () => void;
  onSelectOption: (option: 'existing' | 'author' | 'ai') => void;
}

const OptionsView: React.FC<OptionsViewProps> = ({ onClose, onSelectOption }) => {
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
            <h3>Choose how to add a visual</h3>
            <p className="section-description">Select one of the options below</p>
            
            <div className="options-grid">
              <button 
                className="option-card"
                onClick={() => onSelectOption('existing')}
              >
                <div className="option-icon">📊</div>
                <div className="option-content">
                  <h4>Add from existing report</h4>
                  <p>Select a visual from your Power BI report</p>
                </div>
              </button>

              <button 
                className="option-card"
                onClick={() => onSelectOption('author')}
              >
                <div className="option-icon">✏️</div>
                <div className="option-content">
                  <h4>Author visual</h4>
                  <p>Create a new visual from scratch</p>
                </div>
              </button>

              <button 
                className="option-card"
                onClick={() => onSelectOption('ai')}
              >
                <div className="option-icon">🤖</div>
                <div className="option-content">
                  <h4>Author visual with AI</h4>
                  <p>Let AI help you create a custom visual</p>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default OptionsView;
