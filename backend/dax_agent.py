from typing import List, Dict, Optional
import os
import asyncio
import logging
from dotenv import load_dotenv

from agent_framework import ChatMessage
from agent_framework.azure import AzureAIClient
from azure.identity.aio import DefaultAzureCredential  # Use async credential

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

azure_ai_project_endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
azure_ai_model_deployment_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")
azure_ai_api_key = os.getenv("AZURE_AI_API_KEY")

model_metadata = """
    Table: Category
    • Category[Category ID] (string)
    • Category[Category] (string)

    Table: Orders
    • Orders[Row ID] (int64)
    • Orders[Order ID] (string)
    • Orders[Order Date] (dateTime)
    • Orders[Ship Date] (dateTime)
    • Orders[Ship Mode] (int64)
    • Orders[Customer ID] (string)
    • Orders[Customer Name] (string)
    • Orders[Segment_id] (int64)
    • Orders[Country] (string)
    • Orders[City] (string)
    • Orders[State] (string)
    • Orders[Postal Code] (int64)
    • Orders[Region] (string)
    • Orders[Product ID] (string)
    • Orders[Category_id] (int64)
    • Orders[Sub-Category] (string)
    • Orders[Product_id] (int64)
    • Orders[Sales] (double)
    • Orders[Quantity] (int64)
    • Orders[Discount] (int64)
    • Orders[Profit] (double)
    • Orders[Sales per Unit] (double)
    • Orders[Profit per Unit] (double)
    • Orders[DateDIFF] (int64)
    • Orders[Brand] (calculated column) = "Contoso"
    • Orders[Ship Mode Status] (calculated column) = RELATED('★Orders_Ship_Mode'[★Ship_Mode])

    Table: Mesures (measures table)
    • Mesures[Count order] = DISTINCTCOUNT(Orders[Product ID])
    • Mesures[AVRG Discount] = AVERAGE(Orders[Discount])
    • Mesures[Avrg date] = AVERAGE(Orders[DateDIFF])
    • Mesures[Count Total Customers] = VAR CP = CALCULATETABLE(VALUES(Orders[Customer ID]), FILTER(ALL('Calendar'), 'Calendar'[Date] > MIN('Calendar'[Date]) - (1 * [Interval Value]))) Return COUNTROWS(CP)
    • Mesures[Lost Count Customers] = VAR CP = CALCULATETABLE(VALUES(Orders[Customer ID]), FILTER(ALL('Calendar'), 'Calendar'[Date] > MIN('Calendar'[Date]) - (1 * [Interval Value]) && 'Calendar'[Date] < MIN('Calendar'[Date])-(1 * [Churn Parameter Value]))) VAR PC = CALCULATETABLE(VALUES(Orders[Customer ID]), FILTER(ALL('Calendar'), 'Calendar'[Date] > MIN('Calendar'[Date]) - (1 * [Churn Parameter Value]) && 'Calendar'[Date] < MIN('Calendar'[Date]))) Return COUNTROWS(EXCEPT(CP,PC))

    Table: ★Orders_product
    • ★Orders_product[ProductCategory-EN] (string)
    • ★Orders_product[ProductName-EN] (string)
    • ★Orders_product[ProductID] (int64)
    • ★Orders_product[ProductCategory-ES] (calculated column) = "ES-" & [ProductCategory-EN]
    • ★Orders_product[ProductName-ES] (calculated column) = "ES-" & [ProductName-EN]

    Table: ★Orders_Ship_Mode
    • ★Orders_Ship_Mode[★Ship_Mode] (string)
    • ★Orders_Ship_Mode[Ship_Mode_id] (int64)
    • ★Orders_Ship_Mode[Ship_Mode_sort] (double)

    Relationships:

    Orders[Order Date] → Calendar[Date]
    Orders[Segment_id] → ★Orders_Segment[Segment_id]
    Orders[Category_id] → Orders_Category[Category_id]
    Orders[Ship Mode] → ★Orders_Ship_Mode[Ship_Mode_id]
    Orders[Product_id] → ★Orders_product[ProductID]
    Orders[Category_id] → Category[Category ID]
"""

class DaxAgent:
    """Agent that specializes in translating natural language to DAX queries."""

    def __init__(self):
        self._endpoint = azure_ai_project_endpoint
        self._deployment_name = azure_ai_model_deployment_name
        self._credential: Optional[DefaultAzureCredential] = None
        self._client: Optional[AzureAIClient] = None
        
        if not self._endpoint:
            logger.error("AZURE_AI_PROJECT_ENDPOINT is not set. Cannot initialize DAX agent.")
            raise RuntimeError("AZURE_AI_PROJECT_ENDPOINT is required to initialize DAX agent.")
        
        logger.info(f"DaxAgent configured with endpoint: {self._endpoint}")

    async def start(self):
        """Initialize async resources. Call on app startup."""
        self._credential = DefaultAzureCredential()
        self._client = AzureAIClient(
            project_endpoint=self._endpoint,
            model_deployment_name=self._deployment_name,
            credential=self._credential,
            agent_name="DaxAgent",
        )
        logger.info("DaxAgent started")

    async def stop(self):
        """Cleanup async resources. Call on app shutdown."""
        if self._client:
            await self._client.close()
        if self._credential:
            await self._credential.close()
        logger.info("DaxAgent stopped")
        
    async def generate_dax_query(self, user_query: str) -> str:
        """Generates a DAX query based on the user's natural language query and data model schema.

        Args:
            user_query (str): The natural language query from the user."""
        
        system_instructions = f"""
        You are an expert DAX query generator. Given the following data model schema and the user provided query, generate the appropriate DAX query.

        Data Model Schema:
        {model_metadata}

        Generate only the DAX query without any additional explanation.
        """

        if not self._client:
            raise RuntimeError("DaxAgent not started. Call start() first.")

        messages = [
            ChatMessage(role="system", text=system_instructions),
            ChatMessage(role="user", text=user_query),
        ]

        result = await self._client.get_response(messages)
        logger.info(f"Generated DAX Query: {result.text}")
        return result.text