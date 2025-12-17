import React, { useState, useEffect } from 'react';
import { Page, Report } from 'powerbi-client';
import {
  OptionsView,
  ExistingReportView,
  AuthorVisualView,
  AuthorVisualAIView
} from './modals';
import './VisualCreatorModal.css';

interface VisualCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateVisual: (visualId: string, pageName: string) => void;
  discoveredPages: any[];
  availableVisuals: any[];
  discoveredVisualsMap?: Map<string, any[]>;
  page?: Page | null;
  report?: Report | null;
  onVisualCreated?: () => void;
}

type ViewType = 'options' | 'existing' | 'author' | 'ai';

const VisualCreatorModal: React.FC<VisualCreatorModalProps> = ({
  isOpen,
  onClose,
  onCreateVisual,
  discoveredPages,
  availableVisuals,
  discoveredVisualsMap,
  page,
  report,
  onVisualCreated
}) => {
  const [currentView, setCurrentView] = useState<ViewType>('options');

  // Reset to options view when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentView('options');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBack = () => setCurrentView('options');

  // Render appropriate view based on current state
  switch (currentView) {
    case 'options':
      return (
        <OptionsView
          onClose={onClose}
          onSelectOption={(option) => setCurrentView(option)}
        />
      );
    
    case 'existing':
      return (
        <ExistingReportView
          onClose={onClose}
          onBack={handleBack}
          onCreateVisual={onCreateVisual}
          discoveredPages={discoveredPages}
          discoveredVisualsMap={discoveredVisualsMap}
          report={report}
        />
      );
    
    case 'author':
      return (
        <AuthorVisualView
          onClose={onClose}
          onBack={handleBack}
          page={page}
          onVisualCreated={onVisualCreated}
          onCreateVisual={onCreateVisual}
        />
      );
    
    case 'ai':
      return (
        <AuthorVisualAIView
          onClose={onClose}
          onBack={handleBack}
        />
      );
    
    default:
      return null;
  }
};

export default VisualCreatorModal;
