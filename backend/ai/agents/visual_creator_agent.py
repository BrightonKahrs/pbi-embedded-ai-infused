import json
import logging

from agent_framework import ChatMessage

from ai.ai_config import config
from models.visual_models import VisualConfig
from ai.agents.base_agent import BaseAgent


logger = logging.getLogger(__name__)


system_instructions = f"""
        You are a Power BI visual configuration assistant. Your job is to generate JSON configurations for creating Power BI visuals based on user requests.

        Available visual types:
        {json.dumps(config.visual_types, indent=2)}

        Available data model:
        {config.data_model_schema}

        Data Role Mappings:
        - Category: Use for X-axis labels, pie slices, grouping (use columns, not measures)
        - Y: Use for numeric values, measures, aggregations (typically use measures from Mesures table)
        - Series: Use for line/area chart series breakdown (columns for grouping)
        - Tooltips: Additional context on hover (optional)

        IMPORTANT: You must respond with ONLY a valid JSON object matching this schema:
        {json.dumps(VisualConfig.model_json_schema(), indent=2)}

        Guidelines:
        1. Match visual type to the user's intent:
        - Trends over time → lineChart or areaChart
        - Comparisons between categories → barChart or columnChart  
        - Proportions/percentages → pieChart or donutChart
        2. Always map fields to actual tables/columns from the data model above
        3. Set isMeasure=true for items from the Mesures table
        4. Set isMeasure=false for regular columns
        5. Include a descriptive title based on the user's request
        6. Set appropriate display properties (showLegend, showXAxis, showYAxis) based on visual type

        Example response for "show sales by category":
        {{
        "visualType": "columnChart",
        "title": "Sales by Category",
        "dataFields": [
            {{"dataRole": "Category", "table": "Category", "column": "Category", "isMeasure": false}},
            {{"dataRole": "Y", "table": "Mesures", "column": "Total Sales", "isMeasure": true}}
        ],
        "properties": {{
            "showLegend": false,
            "showXAxis": true,
            "showYAxis": true
        }}
        }}

        Respond with ONLY the JSON object, no additional text or explanation.
"""


class VisualCreatorAgent(BaseAgent):
    """Agent that generates Power BI visual configurations from natural language."""

    def __init__(self) -> None:
        super().__init__(agent_name="VisualCreatorAgent")
        
    async def generate_visual_config(self, user_message: str) -> VisualConfig:
        """Generates a visual configuration based on the user's natural language query and data model schema."""

        if not self._client:
            raise RuntimeError("VisualCreatorAgent not started. Call start() first.")

        messages = [
            ChatMessage(role="system", text=system_instructions),
            ChatMessage(role="user", text=user_message),
        ]

        agent = self._client.create_agent(
            id="VisualCreatorAgent", 
            tools=[], 
            messages=messages,
            response_format=VisualConfig
            )

        result = await agent.run(messages=messages)

        if isinstance(result.value, VisualConfig):
            logger.info(f"Generated Visual Config: {result.value.model_dump_json()}")
            return result.value
        else:
            logger.error("Failed to parse visual config from agent response")
            raise ValueError("Invalid visual config response from agent")