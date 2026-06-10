from pydantic import BaseModel, Field, ConfigDict
from typing import List, Literal


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