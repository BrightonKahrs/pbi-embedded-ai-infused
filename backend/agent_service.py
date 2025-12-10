"""
AI Agent Service using Microsoft Agent Framework SDK
This module provides AI agent capabilities for chat interactions using the official Microsoft Agent Framework
"""
from typing import List, Dict, Optional
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

class AgentService:
    """
    AI Agent service using Microsoft Agent Framework SDK
    
    This implements a chat agent that can understand and respond to user queries
    about Power BI data and analytics using the official Microsoft Agent Framework.
    
    To use with real AI:
    1. Install: pip install agent-framework agent-framework-azure-ai azure-identity
    2. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT_NAME in .env
    3. Or use OPENAI_API_KEY for OpenAI API
    4. Authenticate with Azure CLI: az login (for Azure OpenAI)
    """
    
    def __init__(self):
        self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self.api_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        self.deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o-mini")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o")
        
        self.system_instructions = """You are an AI assistant specialized in Power BI analytics and data visualization.
You help users understand their Power BI reports, answer questions about their data, and provide insights.
Be helpful, concise, and professional in your responses."""
        
        # Initialize agent if credentials are available
        self.agent = None
        self._initialize_agent()
    
    def _initialize_agent(self):
        """Initialize the Microsoft Agent Framework agent"""
        try:
            if self.endpoint:
                # Use Azure OpenAI with Agent Framework
                from agent_framework.azure import AzureOpenAIChatClient
                from azure.identity import DefaultAzureCredential, AzureCliCredential
                
                # Try different credential types
                credential = None
                try:
                    # First try Azure CLI credential (most common for development)
                    credential = AzureCliCredential()
                except Exception:
                    try:
                        # Fallback to default credential chain
                        credential = DefaultAzureCredential()
                    except Exception:
                        print("Warning: Could not initialize Azure credential")
                
                if credential:
                    chat_client = AzureOpenAIChatClient(
                        endpoint=self.endpoint,
                        deployment_name=self.deployment_name,
                        credential=credential
                    )
                    
                    self.agent = chat_client.create_agent(
                        instructions=self.system_instructions,
                        name="PowerBIAnalyticsAgent"
                    )
                    print("Successfully initialized Azure OpenAI Agent Framework agent")
                    
            elif self.api_key:
                # Use OpenAI with Agent Framework
                from agent_framework.openai import OpenAIChatClient
                
                chat_client = OpenAIChatClient(
                    model_id=self.model,
                    api_key=self.api_key
                )
                
                self.agent = chat_client.create_agent(
                    instructions=self.system_instructions,
                    name="PowerBIAnalyticsAgent"
                )
                print("Successfully initialized OpenAI Agent Framework agent")
            else:
                print("Warning: No API credentials found. Agent will use mock responses.")
                
        except ImportError as e:
            print(f"Warning: Agent Framework not available: {e}")
            print("Install with: pip install agent-framework agent-framework-azure-ai azure-identity")
        except Exception as e:
            print(f"Warning: Could not initialize Agent Framework: {e}")
            self.agent = None
    
    async def chat(
        self, 
        messages: List[Dict[str, str]], 
        context: Optional[str] = None
    ) -> str:
        """
        Send a chat message to the AI agent and get a response using Microsoft Agent Framework
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            context: Optional context about Power BI report or data
            
        Returns:
            AI agent's response as a string
        """
        if not self.agent:
            return self._mock_response(messages[-1]["content"] if messages else "")
        
        try:
            # Get the latest user message
            user_message = messages[-1]["content"] if messages else ""
            
            # Add context to the message if provided
            if context:
                user_message = f"Power BI Context: {context}\n\nUser Question: {user_message}"
            
            # Use Agent Framework to get response
            result = await self.agent.run(user_message)
            
            # Return the agent's response text
            return result.text
                
        except Exception as e:
            print(f"Error calling Agent Framework: {e}")
            return self._mock_response(messages[-1]["content"] if messages else "")
    
    def _mock_response(self, user_message: str) -> str:
        """
        Provide a mock response when Microsoft Agent Framework is not configured
        
        Args:
            user_message: The user's message
            
        Returns:
            A mock response string
        """
        response = f"I understand you're asking about: '{user_message}'. "
        response += "I'm an AI assistant ready to help you analyze your Power BI data using Microsoft Agent Framework. "
        response += "\n\n(Note: This is a mock response. To enable real AI responses using Microsoft Agent Framework:\n"
        response += "1. Install: pip install agent-framework agent-framework-azure-ai azure-identity\n"
        response += "2. For Azure OpenAI: Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT_NAME in .env\n"
        response += "3. For OpenAI: Set OPENAI_API_KEY in .env\n"
        response += "4. For Azure OpenAI: Run 'az login' to authenticate with Azure CLI\n"
        response += "5. Optionally set OPENAI_MODEL (default: gpt-4o))"
        return response
    
    async def chat_stream(
        self, 
        messages: List[Dict[str, str]], 
        context: Optional[str] = None
    ):
        """
        Send a chat message to the AI agent and get a streaming response using Microsoft Agent Framework
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            context: Optional context about Power BI report or data
            
        Yields:
            Streaming chunks of the agent's response
        """
        if not self.agent:
            yield self._mock_response(messages[-1]["content"] if messages else "")
            return
        
        try:
            # Get the latest user message
            user_message = messages[-1]["content"] if messages else ""
            
            # Add context to the message if provided
            if context:
                user_message = f"Power BI Context: {context}\n\nUser Question: {user_message}"
            
            # Use Agent Framework streaming to get response
            async for chunk in self.agent.run_stream(user_message):
                if chunk.text:
                    yield chunk.text
                
        except Exception as e:
            print(f"Error calling Agent Framework streaming: {e}")
            yield self._mock_response(messages[-1]["content"] if messages else "")

# Global agent instance
agent_service = AgentService()
