from typing import List, Dict, Optional, Annotated
import os
import asyncio
import logging
import aiohttp
from dotenv import load_dotenv

from agent_framework import ChatMessage
from agent_framework.azure import AzureAIClient
from azure.identity.aio import DefaultAzureCredential  # Use async credential
from pydantic import Field

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Azure AI Configuration
azure_ai_project_endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
azure_ai_model_deployment_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")
azure_ai_api_key = os.getenv("AZURE_AI_API_KEY")

# Power BI configuration
powerbi_workspace_id = os.getenv("POWERBI_WORKSPACE_ID")
powerbi_dataset_id = os.getenv("POWERBI_DATASET_ID")


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
    • Mesures[Total Sales YTD] = TOTALYTD([Total Sales],'Calendar'[Date])

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


async def get_dax_result(dax_query: Annotated[str, Field(description="The DAX query to execute on the power bi semantic model")]) -> str:
    """Execute a DAX query against the Power BI dataset using the Execute Queries API.
    
    API: POST https://api.powerbi.com/v1.0/myorg/groups/{groupId}/datasets/{datasetId}/executeQueries
    """
    logger.info(f"Executing DAX Query: {dax_query}")

    if not powerbi_workspace_id or not powerbi_dataset_id:
        error_msg = "POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID must be set in environment variables"
        logger.error(error_msg)
        return f"Error: {error_msg}"

    # Get access token for Power BI API
    async with DefaultAzureCredential() as credential:
        token = await credential.get_token("https://analysis.windows.net/powerbi/api/.default")
        access_token = token.token

    # Build the API URL
    api_url = f"https://api.powerbi.com/v1.0/myorg/groups/{powerbi_workspace_id}/datasets/{powerbi_dataset_id}/executeQueries"

    # Build the request body
    request_body = {
        "queries": [
            {"query": dax_query}
        ],
        "serializerSettings": {
            "includeNulls": True
        }
    }

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(api_url, json=request_body, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"Power BI API error: {response.status} - {error_text}")
                return f"Error executing DAX query: {error_text}"

            result = await response.json()
            
            # Check for errors in the response
            if result.get("error"):
                error_msg = result["error"].get("message", "Unknown error")
                logger.error(f"DAX execution error: {error_msg}")
                return f"Error: {error_msg}"

            # Extract the results
            results = result.get("results", [])
            if not results:
                return "No results returned"

            # Get the first query result
            query_result = results[0]
            if query_result.get("error"):
                error_msg = query_result["error"].get("message", "Unknown error")
                logger.error(f"DAX query error: {error_msg}")
                return f"Error: {error_msg}"

            # Extract tables and rows
            tables = query_result.get("tables", [])
            if not tables:
                return "No tables returned"

            rows = tables[0].get("rows", [])
            if not rows:
                return "No rows returned"

            logger.info(f"DAX query returned {len(rows)} rows")
            
            # Return the results as a formatted string
            import json
            return json.dumps(rows, indent=2)


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
        You are an expert DAX query generator. Given the following data model schema and the user provided query, answer the question using the get_dax_result tool to execute the DAX query.

        Data Model Schema:
        {model_metadata}

        Steps to follow:
        1. Analyze the user query and determine the appropriate DAX query needed to answer it.
        2. Use the get_dax_result tool to execute the DAX query on the Power BI semantic model.
        3. Return the result obtained from the get_dax_result tool as your final answer
        """

        if not self._client:
            raise RuntimeError("DaxAgent not started. Call start() first.")

        messages = [
            ChatMessage(role="system", text=system_instructions),
            ChatMessage(role="user", text=user_query),
        ]

        agent = self._client.create_agent(id="DaxAgent", tools=[get_dax_result], messages=messages)

        result = await agent.run(messages=messages)
        logger.info(f"Generated DAX Query: {result.text}")
        return result.text