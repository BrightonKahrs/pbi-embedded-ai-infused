import React, { useState, useEffect, useRef } from 'react';
import { Page, Report } from 'powerbi-client';
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';
import 'powerbi-report-authoring';
import { apiService, ChatMessage, VisualConfig } from '../../services/api';

// Schema constants for Power BI API
const schemas = {
  column: "http://powerbi.com/product/schema#column",
  measure: "http://powerbi.com/product/schema#measure",
  property: "http://powerbi.com/product/schema#property",
};

interface AuthorVisualAIViewProps {
  onClose: () => void;
  onBack: () => void;
  page?: Page | null;
  onVisualCreated?: () => void;
  onCreateVisual?: (visualId: string, pageName: string) => void;
}

const AuthorVisualAIView: React.FC<AuthorVisualAIViewProps> = ({
  onClose,
  onBack,
  page: externalPage,
  onVisualCreated,
  onCreateVisual,
}) => {
  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant for creating Power BI visuals. Describe what kind of visual you\'d like to create, and I\'ll help you build it!\n\nFor example, you can say:\n• "Create a bar chart showing sales by category"\n• "Show me a line chart of revenue over time"\n• "Make a pie chart of customer distribution"'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Internal report state for when no external page is provided
  const [internalPage, setInternalPage] = useState<Page | null>(null);
  const [embedConfig, setEmbedConfig] = useState<any>(null);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(false);
  const [embeddedReport, setEmbeddedReport] = useState<Report | null>(null);
  const embeddedReportRef = useRef<Report | null>(null);
  const internalPageRef = useRef<Page | null>(null);

  // Use external page if provided, otherwise use internal page
  const page = externalPage || internalPage;
  const needsEmbeddedReport = !externalPage;

  // Live visual state
  const [liveVisual, setLiveVisual] = useState<any>(null);
  const liveVisualRef = useRef<any>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Track the created page name for cleanup
  const [createdPageName, setCreatedPageName] = useState<string | null>(null);
  const pageCreationStartedRef = useRef<boolean>(false);

  // Scroll chat to bottom on new messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load embed config when we need to embed our own report
  useEffect(() => {
    const loadEmbedConfig = async () => {
      if (needsEmbeddedReport && !embedConfig) {
        setIsLoadingReport(true);
        try {
          const config = await apiService.getPowerBIConfig();
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
              layoutType: models.LayoutType.Custom,
              customLayout: {
                displayOption: models.DisplayOption.FitToPage,
              },
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
            viewMode: models.ViewMode.Edit,
            permissions: models.Permissions.All,
            hideEditBar: true,
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

  // Store embedded report reference and set up event listeners
  const handleEmbeddedComponent = (report: Report) => {
    console.log('AuthorVisualAIView: Got embedded report reference', report);
    embeddedReportRef.current = report;
    setEmbeddedReport(report);

    report.on('loaded', async () => {
      console.log('AuthorVisualAIView: report.on("loaded") fired');
      if (!pageCreationStartedRef.current) {
        await createNewPageForVisual(report);
      }
    });

    report.on('error', (event: any) => {
      console.error('AuthorVisualAIView: report.on("error"):', event?.detail);
    });
  };

  // Create a new page for the visual
  const createNewPageForVisual = async (report: Report) => {
    if (pageCreationStartedRef.current) {
      console.log('AuthorVisualAIView: Page creation already started, skipping...');
      return;
    }
    pageCreationStartedRef.current = true;

    console.log('AuthorVisualAIView: Creating new page for visual...');

    try {
      const newPageName = `AI_Visual_${Date.now()}`;
      console.log('Creating new page:', newPageName);

      const addPageResult = await report.addPage(newPageName);
      console.log('New page created:', addPageResult);
      setCreatedPageName(newPageName);

      const pages = await report.getPages();
      const newPage = pages.find(p => p.name === newPageName || p.displayName === newPageName);

      if (newPage) {
        await newPage.setActive();
        console.log('AuthorVisualAIView: Set new page as active:', newPage.displayName);
        internalPageRef.current = newPage;
        setInternalPage(newPage);
      } else {
        console.error('Could not find newly created page');
        const activePage = pages.find(p => p.isActive) || pages[0];
        if (activePage) {
          internalPageRef.current = activePage;
          setInternalPage(activePage);
        }
      }
    } catch (error) {
      console.error('Error creating new page:', error);
      try {
        const pages = await report.getPages();
        const activePage = pages.find(p => p.isActive) || pages[0];
        if (activePage) {
          console.log('AuthorVisualAIView: Falling back to active page:', activePage.displayName);
          internalPageRef.current = activePage;
          setInternalPage(activePage);
        }
      } catch (fallbackError) {
        console.error('Error getting fallback page:', fallbackError);
      }
    }
  };

  // Handle sending chat message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Send to visual creator AI endpoint
      const response = await apiService.sendVisualChatMessage(
        inputValue,
        messages
      );

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.message
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Apply the visual configuration if we have a page
      if (response.config && page) {
        await applyVisualConfig(response.config);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please make sure the backend server is running.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Apply AI-generated visual configuration to the report
  const applyVisualConfig = async (config: VisualConfig) => {
    const currentPage = internalPageRef.current || page;
    if (!currentPage) {
      console.error('No page available for visual creation');
      return;
    }

    // Delete existing visual if any
    if (liveVisualRef.current) {
      try {
        await (currentPage as any).deleteVisual(liveVisualRef.current.name);
        console.log('Deleted previous visual');
      } catch (e) {
        console.error('Error deleting previous visual:', e);
      }
      // Small delay to ensure Power BI processes the deletion
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Create the visual with layout to fill the page
    const layout = {
      x: 20,
      y: 20,
      width: 1240,
      height: 680,
      displayState: { mode: 0 }
    };

    try {
      console.log('Creating visual with config:', config);
      const visualResponse = await (currentPage as any).createVisual(config.visualType, layout);
      const visual = visualResponse.visual;

      setLiveVisual(visual);
      liveVisualRef.current = visual;
      console.log('Visual created:', visual.name);

      // Add data fields
      for (const field of config.dataFields) {
        try {
          const schema = field.isMeasure ? schemas.measure : schemas.column;
          await visual.addDataField(field.dataRole, {
            table: field.table,
            [field.isMeasure ? "measure" : "column"]: field.column,
            schema: schema
          });
          console.log(`Added data field: ${field.dataRole} = ${field.table}[${field.column}]`);
        } catch (fieldError) {
          console.error(`Error adding field ${field.dataRole}:`, fieldError);
        }
      }

      // Set title if provided
      if (config.title) {
        try {
          await visual.setProperty(
            { objectName: "title", propertyName: "show" },
            { schema: schemas.property, value: true }
          );
          await visual.setProperty(
            { objectName: "title", propertyName: "text" },
            { schema: schemas.property, value: config.title }
          );
          await visual.setProperty(
            { objectName: "title", propertyName: "textSize" },
            { schema: schemas.property, value: 25 }
          );
          console.log('Set title:', config.title);
        } catch (titleError) {
          console.error('Error setting title:', titleError);
        }
      }

      // Apply display properties
      if (config.properties) {
        try {
          if (config.properties.showLegend !== undefined) {
            await visual.setProperty(
              { objectName: "legend", propertyName: "show" },
              { schema: schemas.property, value: config.properties.showLegend }
            );
          }
          if (config.properties.showXAxis !== undefined) {
            await visual.setProperty(
              { objectName: "categoryAxis", propertyName: "show" },
              { schema: schemas.property, value: config.properties.showXAxis }
            );
          }
          if (config.properties.showYAxis !== undefined) {
            await visual.setProperty(
              { objectName: "valueAxis", propertyName: "show" },
              { schema: schemas.property, value: config.properties.showYAxis }
            );
          }
        } catch (propError) {
          console.error('Error setting properties:', propError);
        }
      }

      console.log('Visual configuration applied successfully');
    } catch (error) {
      console.error('Error creating visual from AI config:', error);
      throw error;
    }
  };

  // Handle clearing chat
  const handleClearChat = async () => {
    try {
      await apiService.clearChatHistory();
      setMessages([
        {
          role: 'assistant',
          content: 'Hello! I\'m your AI assistant for creating Power BI visuals. Describe what kind of visual you\'d like to create, and I\'ll help you build it!\n\nFor example, you can say:\n• "Create a bar chart showing sales by category"\n• "Show me a line chart of revenue over time"\n• "Make a pie chart of customer distribution"'
        }
      ]);
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  };

  // Handle close with cleanup
  const handleClose = async () => {
    // Delete visual if exists
    if (liveVisualRef.current) {
      const targetPage = internalPageRef.current || page;
      if (targetPage) {
        try {
          await (targetPage as any).deleteVisual(liveVisualRef.current.name);
        } catch (error) {
          console.error('Error deleting visual on close:', error);
        }
      }
    }

    // Delete created page if needed
    const report = embeddedReportRef.current;
    if (report && createdPageName) {
      try {
        const pages = await report.getPages();
        const pageToDelete = pages.find(p => p.name === createdPageName || p.displayName === createdPageName);
        if (pageToDelete) {
          await report.deletePage(pageToDelete.name);
          console.log('Deleted temporary page:', createdPageName);
        }
      } catch (error) {
        console.error('Error deleting page on close:', error);
      }
    }

    onClose();
  };

  // Handle back with cleanup
  const handleBack = async () => {
    // Same cleanup as close
    if (liveVisualRef.current) {
      const targetPage = internalPageRef.current || page;
      if (targetPage) {
        try {
          await (targetPage as any).deleteVisual(liveVisualRef.current.name);
        } catch (error) {
          console.error('Error deleting visual on back:', error);
        }
      }
    }

    const report = embeddedReportRef.current;
    if (report && createdPageName) {
      try {
        const pages = await report.getPages();
        const pageToDelete = pages.find(p => p.name === createdPageName || p.displayName === createdPageName);
        if (pageToDelete) {
          await report.deletePage(pageToDelete.name);
          console.log('Deleted temporary page:', createdPageName);
        }
      } catch (error) {
        console.error('Error deleting page on back:', error);
      }
    }

    onBack();
  };

  // Keep visual and save - matches AuthorVisualView implementation
  const keepVisual = async () => {
    if (!liveVisual) {
      console.error('No visual to save');
      return;
    }

    setIsSaving(true);
    console.log("Keeping visual on page - saving report...");

    try {
      const currentPage = internalPageRef.current || page;
      // Use ref for immediate access (more reliable than state in async callbacks)
      const report = embeddedReportRef.current;

      if (!report) {
        console.error('No report reference available for saving');
        setIsSaving(false);
        return;
      }

      // Get the visual ID (name) before we clear the reference
      const visualId = liveVisual.name;
      const pageName = currentPage?.name || createdPageName || '';

      console.log('Visual ID to pin:', visualId);
      console.log('Page name:', pageName);
      console.log('Created page name:', createdPageName);

      // Save the report to persist the new visual and new page
      try {
        console.log('Attempting to save report...');
        
        // The report should be dirty because we created a new page
        const wasSavedBefore = await report.isSaved();
        console.log('Report isSaved before save():', wasSavedBefore);

        // Create a promise that resolves when 'saved' event fires
        const savePromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Save timeout - no saved event received after 30 seconds'));
          }, 30000);

          report.on('saved', (event: any) => {
            clearTimeout(timeout);
            console.log('*** SAVED EVENT RECEIVED ***:', event?.detail);
            resolve();
          });
        });

        // Call save()
        console.log('Calling report.save()...');
        const saveResult = await report.save();
        console.log('report.save() returned:', saveResult);

        // Wait for the saved event to confirm
        console.log('Waiting for saved event...');
        await savePromise;
        console.log('Save confirmed by saved event!');

        // Verify save completed
        const isSavedAfter = await report.isSaved();
        console.log('Report isSaved after save():', isSavedAfter);
        console.log('Report saved successfully');
      } catch (saveError: any) {
        console.error('Error saving report:', saveError);
        console.error('Save error details:', JSON.stringify(saveError, null, 2));
        // Don't continue if save fails - the visual won't persist
        alert(`Failed to save report: ${saveError?.message || saveError?.detailedMessage || 'Unknown error'}`);
        setIsSaving(false);
        return;
      }

      // Call onCreateVisual to add the visual to the widgets page
      if (onCreateVisual && visualId && pageName) {
        console.log('Adding visual to widgets:', visualId, pageName);
        onCreateVisual(visualId, pageName);
      }

      // Call the legacy callback if provided
      if (onVisualCreated) {
        onVisualCreated();
      }

      // Clear the live visual ref so it doesn't get deleted on unmount
      setLiveVisual(null);
      liveVisualRef.current = null;
      // Clear the created page name so it doesn't get deleted (we're keeping it!)
      setCreatedPageName(null);

      // Close modal
      onClose();

    } catch (error) {
      console.error('Error keeping visual:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Render chat interface
  const renderChatInterface = () => (
    <div className="ai-chat-panel">
      <div className="chat-panel-header">
        <h3>🤖 AI Visual Assistant</h3>
        <button onClick={handleClearChat} className="clear-chat-button" title="Clear conversation">
          🗑️ Clear
        </button>
      </div>

      <div className="chat-messages-container">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`chat-message ${message.role}`}
          >
            <div className="chat-message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="chat-message-content">
              <div className="chat-message-text">{message.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-message assistant">
            <div className="chat-message-avatar">🤖</div>
            <div className="chat-message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="chat-input-container">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Describe the visual you want to create..."
          className="chat-message-input"
          disabled={isLoading || !page}
        />
        <button
          type="submit"
          className="chat-send-button"
          disabled={!inputValue.trim() || isLoading || !page}
        >
          ➤
        </button>
      </form>

      {!page && needsEmbeddedReport && (
        <div className="chat-waiting-note">
          Waiting for report to load before chat is enabled...
        </div>
      )}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-container modal-container-split" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <button
            className="back-button"
            onClick={handleBack}
            disabled={isSaving}
            aria-label="Back to options"
          >
            ← Back
          </button>
          <h2>Author Visual with AI</h2>
          <button
            className="close-button"
            onClick={handleClose}
            disabled={isSaving}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body modal-body-split">
          {/* Embedded Report Pane */}
          <div className="embedded-report-pane">
            <div className="report-pane-header">
              <span>📊 Live Report Preview</span>
              {isLoadingReport && <span className="loading-indicator">Loading...</span>}
            </div>
            <div className="embedded-report-container">
              {embedConfig ? (
                <PowerBIEmbed
                  embedConfig={embedConfig}
                  eventHandlers={new Map()}
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
            <p className="report-hint">AI-created visuals will appear here</p>
          </div>

          {/* AI Chat Pane */}
          <div className="authoring-pane authoring-pane-side">
            {renderChatInterface()}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-cancel" onClick={handleClose} disabled={isSaving}>
            {liveVisual ? 'Cancel & Delete Visual' : 'Cancel'}
          </button>
          <button
            className="btn-create"
            onClick={keepVisual}
            disabled={!liveVisual || isSaving}
          >
            {isSaving ? 'Saving...' : '✓ Keep Visual'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthorVisualAIView;
