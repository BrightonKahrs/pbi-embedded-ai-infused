"""
AI Agent Service using Microsoft Agent Framework pattern
This module provides AI agent capabilities for chat interactions
"""
from typing import List, Dict, Optional
import os
from dotenv import load_dotenv

load_dotenv()

class AgentService:
    """
    AI Agent service using Microsoft Agent Framework SDK
    
    This implements a chat agent that can understand and respond to user queries
    about Power BI data and analytics.
    
    To use with real AI:
    1. Install: pip install azure-ai-inference
    2. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in .env
    3. Or use OPENAI_API_KEY for OpenAI API
    """
    
    def __init__(self):
        self.api_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        self.endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4")
        self.system_prompt = """You are an AI assistant specialized in Power BI analytics and data visualization.
You help users understand their Power BI reports, answer questions about their data, and provide insights.
Be helpful, concise, and professional in your responses."""
        
        # Initialize client if credentials are available
        self.client = None
        if self.api_key:
            self._initialize_client()
    
    def _initialize_client(self):
        """Initialize the AI client (Azure OpenAI or OpenAI)"""
        try:
            if self.endpoint:
                # Use Azure OpenAI
                from azure.ai.inference import ChatCompletionsClient
                from azure.core.credentials import AzureKeyCredential
                self.client = ChatCompletionsClient(
                    endpoint=self.endpoint,
                    credential=AzureKeyCredential(self.api_key)
                )
            else:
                # Use OpenAI
                from openai import OpenAI
                self.client = OpenAI(api_key=self.api_key)
        except Exception as e:
            print(f"Warning: Could not initialize AI client: {e}")
            self.client = None
    
    async def chat(
        self, 
        messages: List[Dict[str, str]], 
        context: Optional[str] = None
    ) -> str:
        """
        Send a chat message to the AI agent and get a response
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            context: Optional context about Power BI report or data
            
        Returns:
            AI agent's response as a string
        """
        if not self.client:
            return self._mock_response(messages[-1]["content"] if messages else "")
        
        try:
            # Prepare messages with system prompt
            full_messages = [{"role": "system", "content": self.system_prompt}]
            
            # Add context if provided
            if context:
                full_messages.append({
                    "role": "system", 
                    "content": f"Current Power BI context: {context}"
                })
            
            # Add conversation messages
            full_messages.extend(messages)
            
            # Call the AI service
            if self.endpoint:
                # Azure OpenAI
                response = self.client.complete(messages=full_messages)
                return response.choices[0].message.content
            else:
                # OpenAI
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=full_messages
                )
                return response.choices[0].message.content
                
        except Exception as e:
            print(f"Error calling AI service: {e}")
            return self._mock_response(messages[-1]["content"] if messages else "")
    
    def _mock_response(self, user_message: str) -> str:
        """
        Provide a mock response when AI service is not configured
        
        Args:
            user_message: The user's message
            
        Returns:
            A mock response string
        """
        response = f"I understand you're asking about: '{user_message}'. "
        response += "I'm an AI assistant ready to help you analyze your Power BI data. "
        response += "\n\n(Note: This is a mock response. To enable real AI responses, configure your API keys in the .env file:\n"
        response += "- For Azure OpenAI: Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY\n"
        response += "- For OpenAI: Set OPENAI_API_KEY\n"
        response += "- Optionally set OPENAI_MODEL (default: gpt-4))"
        return response

# Global agent instance
agent_service = AgentService()
