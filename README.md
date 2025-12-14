# Power BI Embedded with AI Infusion

A full-stack application that integrates Power BI Embedded with AI-powered chat capabilities using Microsoft Agent Framework.

## 🎯 New: Visual Embedding Support

This application now supports **both full report and specific visual embedding**! See the [Visual Embedding Guide](./VISUAL_EMBEDDING_GUIDE.md) for detailed instructions on how to embed specific visuals from your Power BI reports.

## 🏗️ Architecture

This project consists of two main components:

### Frontend (React + TypeScript)
- **Power BI Embedded**: Interactive Power BI reports embedded in the web application
- **AI Chat Interface**: Real-time chat with an AI agent for data insights
- **Modern UI**: Responsive design with gradient styling

### Backend (FastAPI + Python)
- **FastAPI Server**: High-performance REST API
- **AI Agent Service**: Microsoft Agent Framework pattern for intelligent chat
- **Power BI Integration**: Manages embed tokens and configuration
- **CORS Support**: Configured for frontend communication

## 🚀 Quick Start

### Prerequisites
- **Python 3.8+** for the backend
- **Node.js 14+** for the frontend
- **Power BI account** with embed permissions (optional for testing)
- **Azure OpenAI or OpenAI API key** (optional for AI features)

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and configure your API keys (optional):
   ```env
   # For Azure OpenAI
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
   AZURE_OPENAI_API_KEY=your-azure-api-key
   
   # OR for OpenAI
   OPENAI_API_KEY=your-openai-api-key
   
   # For Power BI (optional)
   POWERBI_EMBED_URL=your-embed-url
   POWERBI_ACCESS_TOKEN=your-access-token
   ```

5. Start the backend server:
   ```bash
   python main.py
   ```
   
   The API will be available at `http://localhost:8000`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Start the development server:
   ```bash
   npm start
   ```
   
   The app will open at `http://localhost:3000`

## 📁 Project Structure

```
pbi-embedded-ai-infused/
├── backend/
│   ├── main.py                 # FastAPI application
│   ├── agent_service.py        # AI Agent service using Microsoft Agent Framework
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example           # Environment variables template
│   └── README.md              # Backend documentation
│
├── frontend/
│   ├── public/                # Static assets
│   ├── src/
│   │   ├── components/
│   │   │   ├── PowerBIReport.tsx    # Power BI embed component
│   │   │   ├── PowerBIReport.css
│   │   │   ├── AIChat.tsx           # AI chat interface
│   │   │   └── AIChat.css
│   │   ├── services/
│   │   │   └── api.ts              # API client
│   │   ├── App.tsx                 # Main application
│   │   └── App.css
│   ├── package.json
│   ├── .env.example
│   └── tsconfig.json
│
└── README.md                   # This file
```

## 🔧 Configuration

### Backend Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | No* |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | No* |
| `OPENAI_API_KEY` | OpenAI API key | No* |
| `OPENAI_MODEL` | OpenAI model (default: gpt-4) | No |
| `POWERBI_EMBED_URL` | Power BI report embed URL | No** |
| `POWERBI_ACCESS_TOKEN` | Power BI access token | No** |

\* Either Azure OpenAI or OpenAI configuration required for AI features. Without these, the app will use mock responses.

\** Required for Power BI features. Without these, the Power BI component will show setup instructions.

### Frontend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REACT_APP_API_URL` | Backend API URL | `http://localhost:8000` |

## 🎯 Features

### Power BI Integration
- Embed Power BI reports directly in the web application
- Interactive filtering and exploration
- Responsive design for various screen sizes

### AI Chat Agent
- Powered by Microsoft Agent Framework pattern
- Supports Azure OpenAI and OpenAI
- Context-aware conversations about Power BI data
- Real-time chat interface with typing indicators
- Conversation history management

### API Endpoints

#### Health Check
- `GET /` - Server health check

#### Chat
- `POST /api/chat` - Send a message to the AI agent
- `GET /api/chat/history` - Retrieve conversation history
- `DELETE /api/chat/history` - Clear conversation history

#### Power BI
- `GET /api/powerbi/config` - Get Power BI embed configuration

## 🧪 Development

### Running Backend in Development Mode

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Running Frontend in Development Mode

```bash
cd frontend
npm start
```

### API Documentation

When the backend is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 🛠️ Technologies Used

### Frontend
- React 18 with TypeScript
- Power BI Client React
- Axios for HTTP requests
- CSS3 with gradient animations

### Backend
- FastAPI (Python web framework)
- Microsoft Agent Framework pattern
- Azure AI / OpenAI SDK
- Pydantic for data validation
- Python-dotenv for configuration

## 📝 Notes

### Microsoft Agent Framework

This project uses the Microsoft Agent Framework pattern for AI agent capabilities. The `agent_service.py` module implements:
- Conversational AI using Azure OpenAI or OpenAI
- System prompts for Power BI-specific assistance
- Context management for better responses
- Graceful fallback to mock responses when not configured

### Power BI Embed Tokens

In production, you should:
1. Use server-side authentication with Azure AD
2. Generate embed tokens dynamically
3. Implement token refresh logic
4. Follow Power BI security best practices

For development, you can use a manually generated embed URL and token from the Power BI portal.

## 🔐 Security Considerations

- Never commit `.env` files with real credentials
- Use environment-specific configurations
- Implement proper authentication for production
- Rotate API keys regularly
- Use HTTPS in production
- Implement rate limiting for API endpoints

## 📄 License

This project is a demo application for Power BI Embedded with AI infusion.

## 🤝 Contributing

This is a demonstration project. Feel free to fork and modify for your own use cases.

## 📞 Support

For issues related to:
- Power BI Embedded: See [Power BI Embedded documentation](https://docs.microsoft.com/power-bi/developer/embedded/)
- Azure OpenAI: See [Azure OpenAI documentation](https://learn.microsoft.com/azure/ai-services/openai/)
- Microsoft Agent Framework: See [Azure AI documentation](https://learn.microsoft.com/azure/ai-services/)

