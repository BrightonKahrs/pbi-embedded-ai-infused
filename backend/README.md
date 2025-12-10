# Power BI Embedded Backend with Microsoft Agent Framework

## Overview
This backend service integrates Power BI Embedded with AI capabilities using the official **Microsoft Agent Framework SDK**. The service provides intelligent chat functionality for analyzing Power BI data and reports.

## Features
- **Microsoft Agent Framework Integration**: Uses the official SDK for robust AI agent capabilities
- FastAPI web server with async support
- Azure OpenAI and OpenAI API support
- Streaming and non-streaming chat responses
- Power BI context-aware responses
- CORS enabled for frontend integration
- Comprehensive error handling and fallback responses

## Microsoft Agent Framework Benefits
- ✅ Official Microsoft SDK for AI agents
- ✅ Built-in Azure authentication and credential management
- ✅ Streaming response support
- ✅ Multi-turn conversation handling
- ✅ Function calling capabilities (extensible)
- ✅ Robust error handling and retry logic
- ✅ Enterprise-ready with Azure integration

## Prerequisites
1. Python 3.10 or later
2. Azure OpenAI resource (recommended) OR OpenAI API key
3. For Azure OpenAI: Azure CLI installed and authenticated (`az login`)

## Setup

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Create a `.env` file based on `.env.example`:

#### Option A: Azure OpenAI (Recommended)
```bash
# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-mini

# Optional: If not using Azure CLI authentication
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
```

#### Option B: OpenAI API
```bash
# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o
```

### 3. Azure Authentication (for Azure OpenAI)
If using Azure OpenAI, authenticate with Azure CLI:
```bash
az login
```

### 4. Test the Agent Service
```bash
python test_agent.py
```

### 5. Run the Server
```bash
python main.py
```

The server will start at `http://localhost:8000`

## API Endpoints

### Core Endpoints
- `GET /` - Health check
- `POST /api/chat` - Chat with AI agent using Microsoft Agent Framework
- `GET /api/chat/history` - Get conversation history
- `DELETE /api/chat/history` - Clear conversation history

### Power BI Integration
- `GET /api/powerbi/config` - Get Power BI configuration

### Chat API Usage

#### Basic Chat Request
```json
POST /api/chat
{
  "messages": [
    {
      "role": "user",
      "content": "What trends do you see in my sales data?"
    }
  ]
}
```

#### Chat with Power BI Context
```json
POST /api/chat
{
  "messages": [
    {
      "role": "user", 
      "content": "Explain this chart"
    }
  ],
  "context": "Current report shows Q4 2024 sales with 15% decline in Northeast region"
}
```

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Architecture

### Agent Service (`agent_service.py`)
- **Microsoft Agent Framework Integration**: Uses `AzureOpenAIChatClient` or `OpenAIChatClient`
- **Intelligent Routing**: Automatically chooses between Azure OpenAI and OpenAI based on configuration
- **Context Awareness**: Incorporates Power BI report context into conversations
- **Streaming Support**: Provides real-time streaming responses via `chat_stream()` method
- **Fallback Handling**: Graceful degradation to mock responses when APIs are unavailable

### Key Components
```python
# Azure OpenAI Agent (Recommended)
from agent_framework.azure import AzureOpenAIChatClient
from azure.identity import AzureCliCredential

agent = AzureOpenAIChatClient(
    endpoint=endpoint,
    deployment_name=deployment_name, 
    credential=AzureCliCredential()
).create_agent(
    instructions="You are an AI assistant specialized in Power BI analytics...",
    name="PowerBIAnalyticsAgent"
)
```

## Configuration Options

### Environment Variables
| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI service endpoint | For Azure OpenAI | - |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | Model deployment name | For Azure OpenAI | `gpt-4o-mini` |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Optional with CLI auth | - |
| `OPENAI_API_KEY` | OpenAI API key | For OpenAI | - |
| `OPENAI_MODEL` | OpenAI model name | Optional | `gpt-4o` |

## Troubleshooting

### Common Issues
1. **Agent Framework Import Error**: Install packages with `pip install agent-framework agent-framework-azure-ai`
2. **Azure Authentication Failed**: Run `az login` or set `AZURE_OPENAI_API_KEY`
3. **Mock Responses Only**: Check environment variables and authentication
4. **Deployment Not Found**: Verify `AZURE_OPENAI_DEPLOYMENT_NAME` matches your Azure OpenAI deployment

### Power BI
- `GET /api/powerbi/config` - Get Power BI embed configuration

## Architecture

The backend uses:
- **FastAPI**: Modern Python web framework
- **Microsoft Agent Framework**: AI agent pattern for chat capabilities
- **Azure AI / OpenAI**: Backend AI services (configurable)
- **Pydantic**: Data validation and settings management
- **python-dotenv**: Environment variable management

## Development

The agent service (`agent_service.py`) implements the Microsoft Agent Framework pattern and can work with:
- Azure OpenAI Service
- OpenAI API
- Mock responses (when no API key is configured)

The service is designed to be extended with additional capabilities like:
- Document retrieval and RAG
- Function calling for Power BI data queries
- Custom tools and plugins
