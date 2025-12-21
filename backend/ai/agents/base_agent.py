from typing import Optional
import logging
from abc import ABC

from agent_framework.azure import AzureAIClient
from azure.identity.aio import DefaultAzureCredential

from ai.ai_config import config


logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Abstract base class for AI agents with shared Azure AI client setup."""

    def __init__(self, agent_name: str):
        """
        Initialize the base agent.
        
        Args:
            agent_name: Name of the agent (used for logging and client identification)
        """
        self._agent_name = agent_name
        self._endpoint = config.azure_ai_project_endpoint
        self._deployment_name = config.azure_ai_model_deployment_name
        self._credential: Optional[DefaultAzureCredential] = None
        self._client: Optional[AzureAIClient] = None
        
        if not self._endpoint:
            logger.error(f"AZURE_AI_PROJECT_ENDPOINT is not set. Cannot initialize {agent_name}.")
            raise RuntimeError(f"AZURE_AI_PROJECT_ENDPOINT is required to initialize {agent_name}.")
        
        logger.info(f"{agent_name} configured with endpoint: {self._endpoint}")

    async def start(self):
        """Initialize async resources. Call on app startup."""
        self._credential = DefaultAzureCredential()
        self._client = AzureAIClient(
            project_endpoint=self._endpoint,
            model_deployment_name=self._deployment_name,
            credential=self._credential,
            agent_name=self._agent_name,
        )
        logger.info(f"{self._agent_name} started")

    async def stop(self):
        """Cleanup async resources. Call on app shutdown."""
        if self._client:
            await self._client.close()
        if self._credential:
            await self._credential.close()
        logger.info(f"{self._agent_name} stopped")
    
    def _ensure_client(self):
        """Ensure client is initialized before use."""
        if not self._client:
            raise RuntimeError(f"{self._agent_name} not started. Call start() first.")