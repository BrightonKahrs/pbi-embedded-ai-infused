"""Tool for introspecting the live Power BI semantic model.

Use this BEFORE writing a DAX query whenever there is any doubt about
whether a column is numeric or text. It runs `EVALUATE INFO.COLUMNS()`
against the live dataset so the agent never has to guess at schema.
"""
from typing import Annotated, Optional
import json
import logging

import aiohttp
from azure.identity.aio import DefaultAzureCredential
from pydantic import Field

from ai.ai_config import config


logger = logging.getLogger(__name__)


_INFO_TARGETS = {
    "tables": "EVALUATE SELECTCOLUMNS(INFO.TABLES(), \"Name\", [Name], \"Description\", [Description], \"IsHidden\", [IsHidden])",
    "columns": (
        "EVALUATE SELECTCOLUMNS("
        "INFO.COLUMNS(), "
        "\"Table\", LOOKUPVALUE(INFO.TABLES()[Name], INFO.TABLES()[ID], [TableID]), "
        "\"Column\", [ExplicitName], "
        "\"DataType\", [ExplicitDataType], "
        "\"IsHidden\", [IsHidden]"
        ")"
    ),
    "measures": (
        "EVALUATE SELECTCOLUMNS("
        "INFO.MEASURES(), "
        "\"Table\", LOOKUPVALUE(INFO.TABLES()[Name], INFO.TABLES()[ID], [TableID]), "
        "\"Measure\", [Name], "
        "\"Expression\", [Expression]"
        ")"
    ),
}

# DataType enum values returned by INFO.COLUMNS() - decode for the agent.
_DATA_TYPE_MAP = {
    1: "Automatic",
    2: "String (text)",
    3: "Int64 (integer)",
    4: "Double (decimal)",
    5: "DateTime",
    6: "Boolean",
    7: "Decimal",
    8: "Binary",
    9: "Variant",
}


async def inspect_data_model_tool(
    target: Annotated[
        str,
        Field(description="What to introspect: 'columns' (default), 'tables', or 'measures'."),
    ] = "columns",
    table_name: Annotated[
        Optional[str],
        Field(description="Optional table name to filter results to a single table."),
    ] = None,
) -> str:
    """Introspect the live Power BI semantic model schema.

    Returns the actual table/column/measure metadata from the dataset using
    DAX INFO functions. Use this whenever you are unsure of a column's
    data type before writing a comparison or filter.
    """
    target = (target or "columns").lower().strip()
    if target not in _INFO_TARGETS:
        return f"Error: target must be one of {list(_INFO_TARGETS)}; got {target!r}"

    if not config.powerbi_workspace_id or not config.powerbi_dataset_id:
        return "Error: POWERBI_WORKSPACE_ID and POWERBI_DATASET_ID must be set"

    query = _INFO_TARGETS[target]
    logger.info(f"Inspecting data model: target={target} table_filter={table_name!r}")

    async with DefaultAzureCredential() as credential:
        token = await credential.get_token("https://analysis.windows.net/powerbi/api/.default")
        access_token = token.token

    api_url = (
        f"https://api.powerbi.com/v1.0/myorg/groups/{config.powerbi_workspace_id}"
        f"/datasets/{config.powerbi_dataset_id}/executeQueries"
    )
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    body = {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}

    async with aiohttp.ClientSession() as session:
        async with session.post(api_url, json=body, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                logger.error(f"INFO query failed: {response.status} - {error_text}")
                return f"Error introspecting data model: {error_text}"
            payload = await response.json()

    try:
        rows = payload["results"][0]["tables"][0]["rows"]
    except (KeyError, IndexError):
        return "Error: unexpected response shape from executeQueries"

    # Decode DataType ints into human-readable names for columns.
    if target == "columns":
        for row in rows:
            dtype_key = next((k for k in row if k.endswith("[DataType]")), None)
            if dtype_key is not None:
                row[dtype_key] = _DATA_TYPE_MAP.get(row[dtype_key], row[dtype_key])

    if table_name:
        wanted = table_name.strip().lower()
        rows = [
            r for r in rows
            if any(
                isinstance(v, str) and v.lower() == wanted
                for k, v in r.items()
                if k.endswith("[Table]") or k.endswith("[Name]")
            )
        ]

    return json.dumps(rows, indent=2)
