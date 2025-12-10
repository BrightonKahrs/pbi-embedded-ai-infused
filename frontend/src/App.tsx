import React, { useState } from 'react';
import './App.css';
import PowerBIReport from './components/PowerBIReport';
import VisualSelector from './components/VisualSelector';
import AIChat from './components/AIChat';

function App() {
  const [embedType, setEmbedType] = useState<'report' | 'visual'>('report');
  const [visualId, setVisualId] = useState<string>('');
  const [pageName, setPageName] = useState<string>('');

  const handleVisualSelect = (selectedVisualId: string) => {
    setVisualId(selectedVisualId);
    setEmbedType('visual');
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>📊 Power BI Embedded with AI</h1>
        <p>Analyze your data with AI-powered insights</p>
        
        {/* Embedding controls */}
        <div className="embed-controls" style={{ marginTop: '20px' }}>
          <label>
            <input 
              type="radio" 
              value="report" 
              checked={embedType === 'report'} 
              onChange={(e) => setEmbedType('report')} 
            />
            Full Report
          </label>
          <label style={{ marginLeft: '15px' }}>
            <input 
              type="radio" 
              value="visual" 
              checked={embedType === 'visual'} 
              onChange={(e) => setEmbedType('visual')} 
            />
            Specific Visual
          </label>
        </div>

        {embedType === 'visual' && (
          <div style={{ marginTop: '15px' }}>
            <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#e8f4f8', borderRadius: '6px' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#333' }}>📍 How to Find Page Names and Visual IDs:</h4>
              <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', color: '#666' }}>
                <li>First embed the full report below</li>
                <li>Use browser console: <code style={{ backgroundColor: '#f0f0f0', padding: '2px 4px', borderRadius: '3px' }}>report.getPages().then(pages =&gt; pages[0].getVisuals())</code></li>
                <li>Note both the page name (e.g., 'ReportSection') and visual name</li>
                <li>Fill in both fields below</li>
              </ol>
            </div>
            
            <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Page Name:</label>
                <input 
                  type="text" 
                  placeholder="Enter Page Name (e.g., 'ReportSection')" 
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  style={{ padding: '8px', width: '200px', fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600' }}>Visual ID:</label>
                <input 
                  type="text" 
                  placeholder="Enter Visual ID" 
                  value={visualId}
                  onChange={(e) => setVisualId(e.target.value)}
                  style={{ padding: '8px', width: '200px', fontFamily: 'monospace' }}
                />
              </div>
              <button onClick={() => { setVisualId(''); setPageName(''); }} style={{ padding: '8px', marginTop: '20px' }}>
                Clear Both
              </button>
            </div>
            <VisualSelector 
              onVisualSelect={handleVisualSelect}
              onPageSelect={setPageName}
              selectedVisualId={visualId}
              selectedPageName={pageName}
            />
          </div>
        )}
      </header>
      <div className="App-content">
        <div className="report-section">
          <PowerBIReport 
            embedType={embedType}
            visualId={embedType === 'visual' ? visualId : undefined}
            pageName={embedType === 'visual' ? pageName : undefined}
          />
        </div>
        <div className="chat-section">
          <AIChat />
        </div>
      </div>
    </div>
  );
}

export default App;
