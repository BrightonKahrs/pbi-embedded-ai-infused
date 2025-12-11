import React from 'react';

interface AuthorVisualAIViewProps {
  onClose: () => void;
  onBack: () => void;
}

const AuthorVisualAIView: React.FC<AuthorVisualAIViewProps> = ({ onClose, onBack }) => {
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
          <h2>Author Visual with AI</h2>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-section">
            <div className="preview-placeholder">
              <div className="preview-icon-large">🤖</div>
              <h3>AI-Powered Visual Creation</h3>
              <p>This feature is coming soon!</p>
              <p className="section-description">
                Use AI to help you create custom visuals based on natural language descriptions.
              </p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorVisualAIView;
