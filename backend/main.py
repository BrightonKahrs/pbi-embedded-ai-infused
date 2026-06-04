"""
FastAPI Backend for Power BI Embedded with AI Agent Chat
"""
import asyncio
import os
import logging 
from typing import Any, Dict, Optional

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from ag_ui.core import CustomEvent, RunErrorEvent
from ag_ui.encoder import EventEncoder
from agent_framework_ag_ui._agent import AgentConfig
from agent_framework_ag_ui._agent_run import run_agent_stream

from pbi.generate_pbi_token import PowerBITokenGenerator
from ai.agents.dax_agent import DaxAgent
from ai.agents.router_agent import RouterAgent
from ai.agents.visual_creator_agent import VisualCreatorAgent
from ai.event_recorder import EventRecorder
from models.response_models import (
    ChatRequest,
    ChatResponse,
    InlineVisual,
    PowerBIConfig,
    VisualChatRequest,
    VisualConfigResponse
)


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logging.getLogger("azure").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


# Shared agent instances
dax_agent = DaxAgent()
visual_creator_agent = VisualCreatorAgent()
# Fast triage/router agent — owns the routing tool that delegates to dax_agent.
router_agent = RouterAgent(dax_agent=dax_agent, visual_creator_agent=visual_creator_agent)


# In-memory conversation history (in production, use a database)
conversation_history = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup
    await dax_agent.start()
    await visual_creator_agent.start()
    await router_agent.start()
    await initialize_pbi_token()
    # Expose agents on app.state for endpoints that prefer DI over module globals.
    app.state.dax_agent = dax_agent
    app.state.visual_creator_agent = visual_creator_agent
    app.state.router_agent = router_agent
    yield
    # Shutdown
    await dax_agent.stop()
    await visual_creator_agent.stop()
    await router_agent.stop()

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


# Global Power BI token info
powerbi_token_info = {
    "embedUrl": "",
    "accessToken": "",
    "reportId": "",
    "workspaceId": "",
    "tokenExpiry": "",
    "reportName": "",
    "tokenType": "Embed",  # "Embed" or "Aad"
    "visuals": []  # List of available visuals
}

async def initialize_pbi_token():
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

@app.post("/api/visual-chat", response_model=VisualConfigResponse)
async def visual_chat(request: VisualChatRequest):
    """
    Chat endpoint for AI-powered visual creation
    Uses VisualCreatorAgent to generate Power BI visual configurations from natural language
    """
    try:
        if not request.message:
            raise HTTPException(status_code=400, detail="No message provided")
        
        # Get visual config from AI agent
        config = await visual_creator_agent.generate_visual_config(
            user_message=request.message
        )
        
        # Generate a friendly response message
        message = f"I've created a {config.visualType} configuration"
        if config.title:
            message += f' titled "{config.title}"'
        message += ". The visual will be created on your report."
        
        return VisualConfigResponse(config=config, message=message)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in visual chat: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating visual config: {str(e)}")
    
@app.post("/api/chat", response_model=ChatResponse)
async def chat_with_agent(request: ChatRequest):
    """
    Chat endpoint for AI agent interaction
    Uses Microsoft Agent Framework that returns Power BI visual configurations
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
        # Record what the agent does this turn so the front-end can show
        # the AG-UI-style explainability panel.
        recorder = EventRecorder()
        recorder.start_run()

        try:
            # Get response from DAX agent. The agent returns the prose
            # answer plus a list of every DAX query it executed (one
            # entry per captured result set) so we can render one inline
            # chart per query.
            answer_text, captured_queries = await dax_agent.generate_dax_query(
                user_query=user_message.content,
                recorder=recorder,
            )
        except Exception:
            recorder.end_run(success=False, error="DAX agent failed")
            raise

        visuals: list[InlineVisual] = []
        if captured_queries:
            try:
                suggested_configs = await visual_creator_agent.suggest_visuals_for_queries(
                    user_message=user_message.content,
                    queries=captured_queries,
                )
                for query, suggested in zip(captured_queries, suggested_configs):
                    if suggested is None:
                        continue
                    visuals.append(
                        InlineVisual(
                            config=suggested,
                            data=query.get("rows", []),
                        )
                    )
            except Exception as e:  # noqa: BLE001 - chart is best-effort
                logger.warning(f"Inline visual suggestion failed: {e}")

        conversation_history.append({
            "role": "assistant",
            "content": answer_text
        })

        recorder.end_run(success=True)

        return ChatResponse(
            message=answer_text,
            role="assistant",
            visual=visuals[0] if visuals else None,
            visuals=visuals,
            events=recorder.events,
        )

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


def _drain_custom_events(
    queue: "asyncio.Queue[tuple[str, Dict[str, Any]]]",
    encoder: EventEncoder,
):
    """Drain pending router-emitted CUSTOM events from ``queue`` and encode them.

    Generator so callers can ``yield from`` it between framework events
    in the SSE pipeline. Each payload pushed by the router agent is
    wrapped as the appropriate AG-UI ``CustomEvent`` and SSE-encoded.
    """
    while not queue.empty():
        try:
            kind, payload = queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        if kind == "handoff":
            yield encoder.encode(CustomEvent(name="AgentHandoff", value=payload))
        elif kind == "inline_visuals":
            yield encoder.encode(CustomEvent(name="InlineVisuals", value=payload))
        else:
            logger.warning(f"Unknown router custom-event kind: {kind}")


@app.post("/api/chat/stream", tags=["AG-UI"])
async def chat_stream(request_body: Dict[str, Any]) -> StreamingResponse:
    """Streaming AG-UI chat endpoint.

    Body shape mirrors ``AGUIRunRequest`` from the AG-UI protocol — at
    minimum ``{"messages": [{"role": "user", "content": "..."}]}``.
    Responds with a ``text/event-stream`` where each ``data:`` line is a
    JSON-encoded AG-UI event (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*,
    CUSTOM, etc.). The router agent additionally emits two CUSTOM event
    families that the front-end recognises:

    * ``AgentHandoff`` — fires when routing to the deep DAX agent.
    * ``InlineVisuals`` — carries one or more ``InlineVisual`` configs
      so the chat can render a Recharts/Power BI preview inline.
    """
    if not isinstance(request_body, dict) or not request_body.get("messages"):
        raise HTTPException(status_code=400, detail="Request body must include 'messages'.")

    custom_event_queue: "asyncio.Queue[tuple[str, Dict[str, Any]]]" = asyncio.Queue()
    agent = router_agent.build_agent(custom_event_queue)
    config = AgentConfig(require_confirmation=False)
    encoder = EventEncoder()

    async def event_generator():
        event_count = 0
        try:
            async for event in run_agent_stream(request_body, agent, config):
                # Flush any router-emitted CUSTOM events ahead of the next framework event.
                for encoded in _drain_custom_events(custom_event_queue, encoder):
                    yield encoded
                event_count += 1
                try:
                    yield encoder.encode(event)
                except Exception as encode_error:  # noqa: BLE001
                    logger.exception("Failed to encode AG-UI event")
                    try:
                        yield encoder.encode(RunErrorEvent(
                            message="Internal error while streaming events.",
                            code=type(encode_error).__name__,
                        ))
                    except Exception:
                        pass
                    return
            # Drain anything the tool put on the queue after the final framework event.
            for encoded in _drain_custom_events(custom_event_queue, encoder):
                yield encoded
            logger.info(f"[/api/chat/stream] streamed {event_count} events")
        except Exception as stream_err:  # noqa: BLE001
            logger.exception("[/api/chat/stream] streaming failed")
            try:
                yield encoder.encode(RunErrorEvent(
                    message=f"Streaming error: {type(stream_err).__name__}: {stream_err}",
                    code="StreamError",
                ))
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

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
            tokenType=powerbi_token_info.get("tokenType", "Embed"),
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
        await initialize_pbi_token()
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
