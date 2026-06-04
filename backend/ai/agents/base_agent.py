from typing import Optional
import logging
from abc import ABC

from agent_framework.foundry import FoundryChatClient
from azure.identity.aio import DefaultAzureCredential

from ai.ai_config import config


logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Abstract base class for AI agents with shared Foundry chat client setup."""

    def __init__(self, agent_name: str, model_deployment_name: Optional[str] = None):
        """
        Initialize the base agent.

        Args:
            agent_name: Name of the agent (used for logging and client identification)
            model_deployment_name: Optional override for the Azure AI model
                deployment to use for this agent. When ``None``, falls back
                to ``config.azure_ai_model_deployment_name``.
        """
        self._agent_name = agent_name
        self._endpoint = config.azure_ai_project_endpoint
        self._deployment_name = model_deployment_name or config.azure_ai_model_deployment_name
        self._credential: Optional[DefaultAzureCredential] = None
        self._client: Optional[FoundryChatClient] = None

        if not self._endpoint:
            logger.error(f"AZURE_AI_PROJECT_ENDPOINT is not set. Cannot initialize {agent_name}.")
            raise RuntimeError(f"AZURE_AI_PROJECT_ENDPOINT is required to initialize {agent_name}.")

        logger.info(f"{agent_name} configured with endpoint: {self._endpoint}")

    async def start(self):
        """Initialize async resources. Call on app startup."""
        self._credential = DefaultAzureCredential()
        self._client = FoundryChatClient(
            project_endpoint=self._endpoint,
            model=self._deployment_name,
            credential=self._credential,
        )
        logger.info(
            f"{self._agent_name} using model deployment: {self._deployment_name}"
        )
        logger.info(f"{self._agent_name} started")

    async def stop(self):
        """Cleanup async resources. Call on app shutdown."""
        # FoundryChatClient does not expose an explicit close; rely on credential cleanup.
        if self._credential:
            await self._credential.close()
        self._client = None
        logger.info(f"{self._agent_name} stopped")
    
    def _ensure_client(self):
        """Ensure client is initialized before use."""
        if not self._client:
            raise RuntimeError(f"{self._agent_name} not started. Call start() first.")