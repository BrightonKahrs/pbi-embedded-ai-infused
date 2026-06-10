import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from agent_framework import Agent, ChatOptions
from agent_framework._skills import SkillsProvider

from ai.ai_config import config
from ai.skills.chart_suggestion_skill import build_chart_suggestion_skills_source
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
        # The chart-suggestion skill teaches the agent how to pick a
        # sensible default visual when answering chat questions inline.
        self._skills_provider = SkillsProvider(build_chart_suggestion_skills_source())

    async def generate_visual_config(self, user_message: str) -> VisualConfig:
        """Generates a visual configuration based on the user's natural language query and data model schema."""

        if not self._client:
            raise RuntimeError("VisualCreatorAgent not started. Call start() first.")

        agent = Agent(
            client=self._client,
            name="VisualCreatorAgent",
            instructions=system_instructions,
            tools=[],
            context_providers=[self._skills_provider],
            default_options=ChatOptions(response_format=VisualConfig),
        )

        result = await agent.run(messages=user_message)

        if isinstance(result.value, VisualConfig):
            logger.info(f"Generated Visual Config: {result.value.model_dump_json()}")
            return result.value
        else:
            logger.error("Failed to parse visual config from agent response")
            raise ValueError("Invalid visual config response from agent")

    async def suggest_visual_for_rows(
        self,
        user_message: str,
        rows: List[Dict[str, Any]],
    ) -> Optional[VisualConfig]:
        """Suggest an inline chart for an answer that already produced rows.

        Returns ``None`` when the rows aren't a good fit for a chart
        preview (single scalar, too dense, or no obvious categorical
        column). Otherwise returns a ``VisualConfig`` whose ``dataFields``
        reference real model tables/columns so the user can later add the
        chart to a Power BI page.
        """
        if not rows:
            return None
        # Skip degenerate shapes early so we don't waste an LLM call.
        if len(rows) == 1 and len(rows[0]) <= 1:
            return None
        if len(rows) > 50:
            return None

        # Sample the first few rows so the model can see column keys
        # (which carry table/column metadata in `Table[Column]` form) and
        # representative values without ballooning the prompt.
        sample = rows[: min(5, len(rows))]
        prompt = (
            f"User question: {user_message}\n"
            f"Result row count: {len(rows)}\n"
            f"Sample rows (first {len(sample)}):\n"
            f"{json.dumps(sample, default=str)}\n\n"
            "Return a VisualConfig that previews these rows well as an "
            "inline chat chart. Use exact table/column names from the "
            "data model. Do not invent fields."
        )

        try:
            return await self.generate_visual_config(prompt)
        except Exception as e:  # noqa: BLE001 - swallow so chat still works
            logger.warning(f"Could not suggest inline visual: {e}")
            return None

    async def suggest_visuals_for_queries(
        self,
        user_message: str,
        queries: List[Dict[str, Any]],
    ) -> List[Optional[VisualConfig]]:
        """Suggest one inline ``VisualConfig`` per captured DAX query.

        ``queries`` is the list emitted by ``DaxAgent.generate_dax_query``
        — each entry is ``{"dax": str, "rows": List[dict]}``. We call
        :meth:`suggest_visual_for_rows` for every query in parallel and
        return the results in the same order. Entries whose rows fail the
        chart-friendliness heuristics (single scalar, too many rows,
        etc.) come back as ``None`` so the caller can pair the result
        list with the original queries by index.
        """
        if not queries:
            return []

        tasks = [
            self.suggest_visual_for_rows(user_message=user_message, rows=q.get("rows", []))
            for q in queries
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        configs: List[Optional[VisualConfig]] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Inline visual suggestion failed: {result}")
                configs.append(None)
            else:
                configs.append(result)
        return configs