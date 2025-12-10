# Power BI Visual Embedding Guide

## Overview
This application now supports both **full report embedding** and **specific visual embedding** in Power BI reports.

## 🎯 Visual Embedding Features

### 1. **Embedding Modes**
- **Full Report**: Embeds the entire Power BI report with all pages and visuals
- **Specific Visual**: Embeds only a specific visual from a report page

### 2. **How to Use Visual Embedding**

#### Method 1: Manual Visual ID Input
1. Start with **Full Report** mode to see your report
2. Right-click on any visual → **Inspect Element**
3. Look for attributes like `data-visual-name` or similar
4. Copy the visual identifier
5. Switch to **Specific Visual** mode
6. Paste the visual ID in the input field

#### Method 2: Browser Console Discovery
1. Embed the full report first
2. Open browser Developer Tools (F12)
3. In the console, run:
   ```javascript
   // Get all pages and their visuals
   report.getPages().then(pages => {
     pages.forEach(page => {
       console.log(`Page: ${page.displayName}`);
       page.getVisuals().then(visuals => {
         visuals.forEach(visual => {
           console.log(`  Visual: ${visual.name} (${visual.type})`);
         });
       });
     });
   });
   ```
4. Copy the visual name from the console output

### 3. **Backend API Changes**

#### Fixed REST API Usage
- ✅ Removed incorrect `/visuals` endpoint that didn't exist in Power BI REST API
- ✅ Updated to use correct `/pages` endpoints only
- ✅ Visual discovery now properly handled client-side

#### New Endpoint Responses
- `/api/powerbi/config?visual_id=<id>` - Returns visual-specific configuration
- `/api/powerbi/visuals` - Returns page information with visual discovery guidance

### 4. **Technical Implementation**

#### Visual Embedding Configuration
```typescript
const visualConfig: models.IVisualEmbedConfiguration = {
  type: 'visual',
  embedUrl: reportEmbedUrl,
  accessToken: embedToken,
  visualName: visualId,
  tokenType: models.TokenType.Embed,
  settings: {
    background: models.BackgroundType.Transparent,
  }
};
```

#### Backend Visual URL Generation
```python
def get_visual_embed_url(self, report_id: str, page_name: str, visual_name: str, workspace_id: Optional[str] = None) -> str:
    base_embed_url = f"https://app.powerbi.com/reportEmbed?reportId={report_id}"
    if workspace_id:
        base_embed_url += f"&groupId={workspace_id}"
    return f"{base_embed_url}&pageName={page_name}&visualName={visual_name}"
```

## 🚨 Important Notes

### Visual Discovery Limitations
- **Power BI REST API does not provide visual enumeration**
- Visual discovery must be done **client-side** after report embedding
- This is a Power BI platform limitation, not an application bug

### Authentication Requirements
- Ensure you're logged in with `az login`
- Your Azure account must have access to the Power BI workspace and reports
- Set `POWERBI_REPORT_ID` and optionally `POWERBI_WORKSPACE_ID` in your `.env` file

## 🔧 Configuration

### Environment Variables
```bash
POWERBI_REPORT_ID=your-report-id-here
POWERBI_WORKSPACE_ID=your-workspace-id-here  # Optional, uses "My Workspace" if not set
```

### Frontend Environment
```bash
REACT_APP_API_URL=http://localhost:8000  # Backend API URL
```

## 🎉 Success Criteria
- [x] Support both report and visual embedding modes
- [x] Proper error handling for visual discovery limitations
- [x] User-friendly interface with clear instructions
- [x] Correct Power BI REST API usage
- [x] Client-side visual discovery guidance
- [x] TypeScript compilation without errors

## 📝 Usage Examples

### Full Report Embedding
```typescript
<PowerBIReport embedType="report" />
```

### Visual Embedding
```typescript
<PowerBIReport 
  embedType="visual" 
  visualId="chart_abc123" 
/>
```

## 🐛 Troubleshooting

### "No HTTP resource was found" Error
This error occurred because we were using non-existent Power BI REST API endpoints. **This has been fixed** by:
- Removing incorrect `/visuals` endpoints
- Using only supported `/pages` endpoints
- Moving visual discovery to client-side

### Visual Not Found
- Ensure the visual ID is correct (case-sensitive)
- Visual IDs change when reports are republished
- Use browser developer tools to find current visual IDs