from typing import List, Optional
from pydantic import BaseModel

from models.visual_models import VisualConfig


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

class VisualChatRequest(BaseModel):
    message: str
    conversationHistory: Optional[List[dict]] = None

class VisualConfigResponse(BaseModel):
    config: VisualConfig
    message: str