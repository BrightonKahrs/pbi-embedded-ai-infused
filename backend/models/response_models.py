from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from models.visual_models import VisualConfig


class ChatMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[str] = None


class InlineVisual(BaseModel):
    """A visual the AI suggests rendering inline in the chat bubble.

    Carries both the Power BI visual configuration (for use with
    page.createVisual when the user clicks "Add to page") and the raw
    rows captured from the DAX query so the front-end can paint a
    light-weight Recharts preview without re-querying.
    """
    config: VisualConfig
    data: List[Dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    message: str
    role: str = "assistant"
    # ``visual`` is kept for backwards compatibility with clients that only
    # know how to render a single inline chart. When ``visuals`` is
    # populated, ``visual`` mirrors ``visuals[0]``.
    visual: Optional[InlineVisual] = None
    visuals: List[InlineVisual] = Field(default_factory=list)

class PowerBIConfig(BaseModel):
    embedUrl: str
    accessToken: str
    embedType: str = "report"  # "report" or "visual"
    tokenType: str = "Embed"  # "Embed" or "Aad"
    visualId: Optional[str] = None
    reportId: Optional[str] = None
    workspaceId: Optional[str] = None

class VisualChatRequest(BaseModel):
    message: str
    conversationHistory: Optional[List[dict]] = None

class VisualConfigResponse(BaseModel):
    config: VisualConfig
    message: str