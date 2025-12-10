"""
FastAPI Backend for Power BI Embedded with AI Agent Chat
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
from dotenv import load_dotenv
from agent_service import agent_service

# Load environment variables
load_dotenv()

app = FastAPI(
    title="Power BI Embedded AI Backend",
    description="Backend API for Power BI Embedded with AI Agent Chat capabilities",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response models
class ChatMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[str] = None

class ChatResponse(BaseModel):
    message: str
    role: str = "assistant"

class PowerBIConfig(BaseModel):
    embedUrl: str
    accessToken: str
    embedType: str = "report"

# In-memory conversation history (in production, use a database)
conversation_history = []

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "Power BI Embedded AI Backend is running",
        "version": "1.0.0"
    }

@app.post("/api/chat", response_model=ChatResponse)
async def chat_with_agent(request: ChatRequest):
    """
    Chat endpoint for AI agent interaction
    Uses Microsoft Agent Framework for intelligent responses
    """
    try:
        # Add user message to history
        user_message = request.messages[-1] if request.messages else None
        if not user_message:
            raise HTTPException(status_code=400, detail="No message provided")
        
        # Store conversation
        conversation_history.append({
            "role": user_message.role,
            "content": user_message.content
        })
        
        # Convert messages to dict format for agent service
        messages_dict = [{"role": msg.role, "content": msg.content} for msg in request.messages]
        
        # Get response from AI agent
        response_content = await agent_service.chat(
            messages=messages_dict,
            context=request.context
        )
        
        conversation_history.append({
            "role": "assistant",
            "content": response_content
        })
        
        return ChatResponse(message=response_content, role="assistant")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing chat: {str(e)}")

@app.get("/api/chat/history")
async def get_chat_history():
    """Get conversation history"""
    return {"messages": conversation_history}

@app.delete("/api/chat/history")
async def clear_chat_history():
    """Clear conversation history"""
    conversation_history.clear()
    return {"message": "Chat history cleared"}

@app.get("/api/powerbi/config")
async def get_powerbi_config():
    """
    Get Power BI configuration
    In production, this would authenticate and get embed tokens from Power BI API
    """
    # These should come from environment variables in production
    embed_url = os.getenv("POWERBI_EMBED_URL", "")
    access_token = os.getenv("POWERBI_ACCESS_TOKEN", "")
    
    if not embed_url or not access_token:
        raise HTTPException(
            status_code=500, 
            detail="Power BI configuration not set. Please configure POWERBI_EMBED_URL and POWERBI_ACCESS_TOKEN environment variables."
        )
    
    return PowerBIConfig(
        embedUrl=embed_url,
        accessToken=access_token,
        embedType="report"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
