"""
FastAPI Backend for Power BI Embedded with AI Agent Chat
"""
import os
import logging 
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from generate_pbi_token import PowerBITokenGenerator
from dax_agent import DaxAgent

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Shared DaxAgent instance
dax_agent = DaxAgent()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup
    await dax_agent.start()
    await generate_powerbi_token()
    yield
    # Shutdown
    await dax_agent.stop()

app = FastAPI(
    title="Power BI Embedded AI Backend",
    description="Backend API for Power BI Embedded with AI Agent Chat capabilities",
    version="1.0.0",
    lifespan=lifespan
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
    embedType: str = "report"  # "report" or "visual"
    visualId: Optional[str] = None
    reportId: Optional[str] = None
    workspaceId: Optional[str] = None

# In-memory conversation history (in production, use a database)
conversation_history = []

# Global Power BI token info
powerbi_token_info = {
    "embedUrl": "",
    "accessToken": "",
    "reportId": "",
    "workspaceId": "",
    "tokenExpiry": "",
    "reportName": "",
    "visuals": []  # List of available visuals
}

async def generate_powerbi_token():
    """Generate Power BI embed token at startup"""
    global powerbi_token_info
    
    # Get configuration from environment variables
    report_id = os.getenv("POWERBI_REPORT_ID")
    workspace_id = os.getenv("POWERBI_WORKSPACE_ID")  # Optional
    
    if not report_id:
        logger.warning("POWERBI_REPORT_ID not set. Power BI functionality will be limited.")
        logger.info("To enable automatic token generation, set POWERBI_REPORT_ID in your .env file")
        return
    
    try:
        logger.info("Generating Power BI embed token using Azure CLI authentication...")
        logger.info(f"Report ID: {report_id}")
        if workspace_id:
            logger.info(f"Workspace ID: {workspace_id}")
        else:
            logger.info("Using 'My Workspace' (no workspace ID specified)")
            
        generator = PowerBITokenGenerator()
        token_info = generator.generate_embed_token(report_id, workspace_id)
        
        if token_info and token_info.get("embedToken"):
            powerbi_token_info.update(token_info)
            logger.info(f"✅ Successfully generated Power BI token for report: {token_info.get('reportName', 'Unknown')}")
            logger.info(f"Token expires at: {token_info.get('tokenExpiry', 'Unknown')}")
        else:
            logger.error("❌ Failed to generate Power BI embed token - no token returned")
    except Exception as e:
        logger.error(f"❌ Error generating Power BI token: {e}")
        logger.warning("Power BI functionality will use environment variables if available")
        logger.info("Make sure you're logged in with 'az login' and have access to the Power BI report")

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
        
        # Get response from AI agent (using shared dax_agent instance)
        response_content = await dax_agent.generate_dax_query(
            user_query=user_message.content
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
async def get_powerbi_config(visual_id: Optional[str] = None):
    """
    Get Power BI configuration
    Uses dynamically generated embed token from Azure CLI authentication
    
    Args:
        visual_id: Optional visual ID for visual-specific embedding
    """
    global powerbi_token_info
    
    # Check if we have generated token info
    if powerbi_token_info.get("embedUrl") and powerbi_token_info.get("embedToken"):
        logger.info("Using dynamically generated Power BI token")
        
        embed_url = powerbi_token_info["embedUrl"]
        embed_type = "report"
        
        # If visual_id is specified, modify for visual embedding
        if visual_id:
            embed_type = "visual"
            # For visual embedding, we'll use the same embed URL
            # The visual-specific targeting will be handled by the frontend PowerBI client
            # Visual IDs should be provided by user or discovered client-side
            logger.info(f"Configured for visual embedding with visual ID: {visual_id}")
            logger.info("Note: Visual targeting will be handled by frontend PowerBI client")
        
        return PowerBIConfig(
            embedUrl=embed_url,
            accessToken=powerbi_token_info["embedToken"],
            embedType=embed_type,
            visualId=visual_id,
            reportId=powerbi_token_info.get("reportId"),
            workspaceId=powerbi_token_info.get("workspaceId")
        )
    
    # Fallback to environment variables
    embed_url = os.getenv("POWERBI_EMBED_URL", "")
    access_token = os.getenv("POWERBI_ACCESS_TOKEN", "")
    
    if embed_url and access_token:
        logger.info("Using Power BI token from environment variables")
        return PowerBIConfig(
            embedUrl=embed_url,
            accessToken=access_token,
            embedType="report"
        )
    
    # No configuration available
    raise HTTPException(
        status_code=500, 
        detail="Power BI configuration not available. Set POWERBI_REPORT_ID (and optionally POWERBI_WORKSPACE_ID) in .env, or set POWERBI_EMBED_URL and POWERBI_ACCESS_TOKEN manually. Make sure you're logged in with 'az login'."
    )

@app.get("/api/powerbi/refresh-token")
async def refresh_powerbi_token():
    """
    Refresh the Power BI embed token
    """
    try:
        await generate_powerbi_token()
        if powerbi_token_info.get("embedToken"):
            return {
                "success": True,
                "message": "Power BI token refreshed successfully",
                "tokenExpiry": powerbi_token_info.get("tokenExpiry", "Unknown"),
                "reportName": powerbi_token_info.get("reportName", "Unknown")
            }
        else:
            return {
                "success": False,
                "message": "Failed to refresh Power BI token"
            }
    except Exception as e:
        logger.error(f"Error refreshing Power BI token: {e}")
        raise HTTPException(status_code=500, detail=f"Error refreshing token: {str(e)}")

@app.get("/api/powerbi/status")
async def get_powerbi_status():
    """
    Get Power BI token status and information
    """
    global powerbi_token_info
    
    return {
        "tokenGenerated": bool(powerbi_token_info.get("embedToken")),
        "reportName": powerbi_token_info.get("reportName", "Unknown"),
        "reportId": powerbi_token_info.get("reportId", "Not set"),
        "workspaceId": powerbi_token_info.get("workspaceId", "My Workspace"),
        "tokenExpiry": powerbi_token_info.get("tokenExpiry", "Unknown"),
        "hasEmbedUrl": bool(powerbi_token_info.get("embedUrl")),
        "configuredFromEnv": {
            "POWERBI_REPORT_ID": bool(os.getenv("POWERBI_REPORT_ID")),
            "POWERBI_WORKSPACE_ID": bool(os.getenv("POWERBI_WORKSPACE_ID")),
            "POWERBI_EMBED_URL": bool(os.getenv("POWERBI_EMBED_URL")),
            "POWERBI_ACCESS_TOKEN": bool(os.getenv("POWERBI_ACCESS_TOKEN"))
        },
        "visualsAvailable": len(powerbi_token_info.get("visuals", []))
    }

@app.get("/api/powerbi/visuals")
async def get_powerbi_visuals():
    """
    Get list of available visuals in the report
    """
    global powerbi_token_info
    
    # Check if Power BI token is available
    if not powerbi_token_info.get("embedToken"):
        raise HTTPException(
            status_code=404,
            detail="No Power BI report loaded. Make sure POWERBI_REPORT_ID is configured and the app has generated a token."
        )
    
    # Get pages information (visuals not available through REST API)
    pages_data = powerbi_token_info.get("pages", [])
    
    if not pages_data:
        raise HTTPException(
            status_code=404,
            detail="No pages found in the report. This might be due to permissions or the report structure."
        )
    
    # Return page information with note about visual discovery
    return {
        "totalPages": len(pages_data),
        "pages": {page.get("displayName", page.get("name", "Unknown")): [] for page in pages_data},
        "pagesInfo": pages_data,
        "note": "Visual discovery requires client-side JavaScript API after report embedding",
        "instructions": "To discover visuals, embed the report first and use PowerBI JavaScript client API methods like report.getPages() and page.getVisuals()"
    }

@app.get("/api/azure/auth-test")
async def test_azure_authentication():
    """
    Test Azure CLI authentication
    """
    try:
        from azure.identity import AzureCliCredential, DefaultAzureCredential
        
        # Test Azure CLI credential
        try:
            credential = AzureCliCredential()
            # Test getting a token for Power BI
            token = credential.get_token("https://analysis.windows.net/powerbi/api/.default")
            
            return {
                "success": True,
                "method": "Azure CLI",
                "message": "Successfully authenticated with Azure CLI",
                "tokenObtained": bool(token and token.token),
                "tokenPrefix": token.token[:20] + "..." if token and token.token else "None"
            }
        except Exception as cli_error:
            # Try default credential
            try:
                credential = DefaultAzureCredential()
                token = credential.get_token("https://analysis.windows.net/powerbi/api/.default")
                
                return {
                    "success": True,
                    "method": "Default Azure Credential",
                    "message": "Successfully authenticated with Default Azure Credential",
                    "tokenObtained": bool(token and token.token),
                    "tokenPrefix": token.token[:20] + "..." if token and token.token else "None",
                    "cliError": str(cli_error)
                }
            except Exception as default_error:
                return {
                    "success": False,
                    "method": "None",
                    "message": "Failed to authenticate with Azure",
                    "cliError": str(cli_error),
                    "defaultError": str(default_error),
                    "suggestion": "Run 'az login' to authenticate with Azure CLI"
                }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error testing authentication: {str(e)}"
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
