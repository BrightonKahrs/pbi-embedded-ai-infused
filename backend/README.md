# Backend - FastAPI with AI Agent

This is the FastAPI backend for the Power BI Embedded AI application. It provides:
- AI chat agent endpoints using Microsoft Agent Framework pattern
- Power BI configuration management
- CORS-enabled API for frontend communication

## Setup

1. **Install Python dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys
   ```

3. **Configure AI Service (choose one):**
   
   **Option A: Azure OpenAI**
   ```
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
   AZURE_OPENAI_API_KEY=your-azure-openai-api-key
   ```
   
   **Option B: OpenAI**
   ```
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_MODEL=gpt-4
   ```

4. **Configure Power BI (optional):**
   ```
   POWERBI_EMBED_URL=https://app.powerbi.com/reportEmbed?reportId=your-report-id&groupId=your-group-id
   POWERBI_ACCESS_TOKEN=your-powerbi-access-token
   ```

## Running the Server

```bash
cd backend
python main.py
```

Or with uvicorn directly:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## API Endpoints

### Health Check
- `GET /` - Check server status

### Chat
- `POST /api/chat` - Send a message to the AI agent
- `GET /api/chat/history` - Get conversation history
- `DELETE /api/chat/history` - Clear conversation history

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
