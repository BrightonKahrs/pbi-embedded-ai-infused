import React from 'react';
import './App.css';
import PowerBIReport from './components/PowerBIReport';
import AIChat from './components/AIChat';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>📊 Power BI Embedded with AI</h1>
        <p>Analyze your data with AI-powered insights</p>
      </header>
      <div className="App-content">
        <div className="report-section">
          <PowerBIReport />
        </div>
        <div className="chat-section">
          <AIChat />
        </div>
      </div>
    </div>
  );
}

export default App;
