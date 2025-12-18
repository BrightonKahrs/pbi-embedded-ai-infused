from typing import List, Dict, Optional, Literal
import os
import json
import logging
from dotenv import load_dotenv

from agent_framework import ChatMessage
from agent_framework.azure import AzureAIClient
from azure.identity.aio import DefaultAzureCredential  # Use async credential
from pydantic import Field, BaseModel, ConfigDict

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Azure AI Configuration
azure_ai_project_endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
azure_ai_model_deployment_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")

# Pydantic models for visual configuration
class DataField(BaseModel):
    """Represents a data field binding for a Power BI visual."""
    dataRole: Literal["Category", "Y", "Series", "Tooltips"] = Field(
        description="The data role this field maps to in the visual"
    )
    table: str = Field(description="Table name from the data model")
    column: str = Field(description="Column or measure name")
    isMeasure: bool = Field(
        description="True for measures (from Mesures table), false for regular columns"
    )
    model_config = ConfigDict(extra="forbid")


class VisualProperties(BaseModel):
    """Display properties for a Power BI visual."""
    showLegend: bool = Field(description="Whether to show the legend")
    showXAxis: bool = Field(description="Whether to show the X axis")
    showYAxis: bool = Field(description="Whether to show the Y axis")
    model_config = ConfigDict(extra="forbid")


class VisualConfig(BaseModel):
    """Complete configuration for creating a Power BI visual."""
    visualType: Literal["columnChart", "barChart", "pieChart", "lineChart", "areaChart", "donutChart"] = Field(
        description="The type of Power BI visual to create"
    )
    title: str = Field(description="Descriptive title for the visual")
    dataFields: List[DataField]
    properties: VisualProperties
    model_config = ConfigDict(extra="forbid")


# Generate JSON schema string from Pydantic model for the prompt
VISUAL_CONFIG_SCHEMA = json.dumps(VisualConfig.model_json_schema(), indent=2)

# Visual types available for Power BI Embedded
VISUAL_TYPES = [
    {"name": "columnChart", "displayName": "Column Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
    {"name": "barChart", "displayName": "Bar Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
    {"name": "pieChart", "displayName": "Pie Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
    {"name": "lineChart", "displayName": "Line Chart", "dataRoles": ["Category", "Series", "Y"]},
    {"name": "areaChart", "displayName": "Area Chart", "dataRoles": ["Category", "Series", "Y"]},
    {"name": "donutChart", "displayName": "Donut Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
]

# Data model schema - matches the dax_agent model_metadata
DATA_MODEL_SCHEMA = """
Tables and Columns:

Table: Category
• Category[Category ID] (string) - Category identifier
• Category[Category] (string) - Category name

Table: Orders
• Orders[Order ID] (string)
• Orders[Order Date] (dateTime)
• Orders[Customer Name] (string)
• Orders[Segment_id] (int64)
• Orders[Country] (string)
• Orders[City] (string)
• Orders[State] (string)
• Orders[Region] (string)
• Orders[Category_id] (int64)
• Orders[Sub-Category] (string)
• Orders[Sales] (double)
• Orders[Quantity] (int64)
• Orders[Discount] (int64)
• Orders[Profit] (double)

Table: Mesures (measures table)
• Mesures[Count order] = DISTINCTCOUNT(Orders[Product ID]) - Count of distinct orders
• Mesures[AVRG Discount] = AVERAGE(Orders[Discount]) - Average discount
• Mesures[Total Sales YTD] = TOTALYTD([Total Sales],'Calendar'[Date]) - Year to date sales
• Mesures[Total Sales] = CALCULATE(SUM(Orders[Sales])) - Total sales amount

Table: ★Orders_product
• ★Orders_product[ProductCategory-EN] (string) - Product category name
• ★Orders_product[ProductName-EN] (string) - Product name
• ★Orders_product[ProductID] (int64)

Table: ★Orders_Ship_Mode
• ★Orders_Ship_Mode[★Ship_Mode] (string) - Shipping mode name
• ★Orders_Ship_Mode[Ship_Mode_id] (int64)

Table: Calendar
• Calendar[Date] (dateTime)
• Calendar[Year] (int64)
• Calendar[Month] (string)
• Calendar[Quarter] (string)
"""


class VisualCreatorAgent:
    """Agent that generates Power BI visual configurations from natural language."""

    def __init__(self):
        self._endpoint = azure_ai_project_endpoint
        self._deployment_name = azure_ai_model_deployment_name
        self._credential: Optional[DefaultAzureCredential] = None
        self._client: Optional[AzureAIClient] = None
        
        if not self._endpoint:
            logger.error("AZURE_AI_PROJECT_ENDPOINT is not set. Cannot initialize DAX agent.")
            raise RuntimeError("AZURE_AI_PROJECT_ENDPOINT is required to initialize DAX agent.")
        
        logger.info(f"VisualCreationAgent configured with endpoint: {self._endpoint}")

    async def start(self):
        """Initialize async resources. Call on app startup."""
        self._credential = DefaultAzureCredential()
        self._client = AzureAIClient(
            project_endpoint=self._endpoint,
            model_deployment_name=self._deployment_name,
            credential=self._credential,
            agent_name="VisualCreationAgent",
        )
        logger.info("VisualCreationAgent started")

    async def stop(self):
        """Cleanup async resources. Call on app shutdown."""
        if self._client:
            await self._client.close()
        if self._credential:
            await self._credential.close()
        logger.info("VisualCreationAgent stopped")
        
    async def generate_visual_config(self, user_message: str) -> VisualConfig:
        """Generates a visual configuration based on the user's natural language query and data model schema.

        Args:
            user_message (str): The natural language query from the user."""
        
        system_instructions = f"""
        You are a Power BI visual configuration assistant. Your job is to generate JSON configurations for creating Power BI visuals based on user requests.

        Available visual types:
        {json.dumps(VISUAL_TYPES, indent=2)}

        Available data model:
        {DATA_MODEL_SCHEMA}

        Data Role Mappings:
        - Category: Use for X-axis labels, pie slices, grouping (use columns, not measures)
        - Y: Use for numeric values, measures, aggregations (typically use measures from Mesures table)
        - Series: Use for line/area chart series breakdown (columns for grouping)
        - Tooltips: Additional context on hover (optional)

        IMPORTANT: You must respond with ONLY a valid JSON object matching this schema:
        {VISUAL_CONFIG_SCHEMA}

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

        Respond with ONLY the JSON object, no additional text or explanation."""

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
            logger.info(f"Generated Visual Config: {result.value.json()}")
            return result.value
        else:
            logger.error("Failed to parse visual config from agent response")
            raise ValueError("Invalid visual config response from agent")