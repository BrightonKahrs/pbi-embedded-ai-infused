from typing import Annotated
import logging

import aiohttp
from azure.identity.aio import DefaultAzureCredential
from pydantic import Field

from ai.ai_config import config


logger = logging.getLogger(__name__)


async def execute_dax_query_tool(dax_query: Annotated[str, Field(description="The DAX query to execute on the power bi semantic model")]) -> str:
    """Execute a DAX query against the Power BI dataset using the Execute Queries API.
    
    API: POST https://api.powerbi.com/v1.0/myorg/groups/{groupId}/datasets/{datasetId}/executeQueries
    """
    logger.info(f"Executing DAX Query: {dax_query}")

    if not config.powerbi_workspace_id or not config.powerbi_dataset_id:
        error_msg = "POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID must be set in environment variables"
        logger.error(error_msg)
        return f"Error: {error_msg}"

    # Get access token for Power BI API
    async with DefaultAzureCredential() as credential:
        token = await credential.get_token("https://analysis.windows.net/powerbi/api/.default")
        access_token = token.token

    # Build the API URL
    api_url = f"https://api.powerbi.com/v1.0/myorg/groups/{config.powerbi_workspace_id}/datasets/{config.powerbi_dataset_id}/executeQueries"

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
