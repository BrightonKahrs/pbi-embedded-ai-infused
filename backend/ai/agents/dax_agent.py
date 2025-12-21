import logging

from agent_framework import ChatMessage

from ai.ai_config import config
from ai.tools.execute_dax_query_tool import execute_dax_query_tool
from ai.agents.base_agent import BaseAgent


logger = logging.getLogger(__name__)


system_instructions = f"""
    You are an expert DAX query generator. Given the following data model schema and the user provided query, answer the question using the get_dax_result tool to execute the DAX query.

    Data Model Schema:
    {config.data_model_schema}

    Steps to follow:
    1. Analyze the user query and determine the appropriate DAX query needed to answer it.
    2. Use the get_dax_result tool to execute the DAX query on the Power BI semantic model.
    3. Return the result obtained from the get_dax_result tool as your final answer
"""


class DaxAgent(BaseAgent):
    """Agent that specializes in translating natural language to DAX queries."""

    def __init__(self):
        super().__init__(agent_name="DaxAgent")
        
    async def generate_dax_query(self, user_query: str) -> str:
        """Generates a DAX query based on the user's natural language query and data model schema.

        Args:
            user_query (str): The natural language query from the user."""
        
        self._ensure_client()
        
        if not self._client:
            raise RuntimeError("DaxAgent not started. Call start() first.")

        messages = [
            ChatMessage(role="system", text=system_instructions),
            ChatMessage(role="user", text=user_query),
        ]

        agent = self._client.create_agent(
            id="DaxAgent", 
            tools=[execute_dax_query_tool], 
            messages=messages
        )

        result = await agent.run(messages=messages)
        logger.info(f"Generated DAX Query: {result.text}")
        return result.text