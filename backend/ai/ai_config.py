from dotenv import load_dotenv
import os

load_dotenv()

class Config:

    def __init__(self):
        # Azure AI Configuration
        self.azure_ai_project_endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
        self.azure_ai_model_deployment_name = os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")
        self.azure_ai_api_key = os.getenv("AZURE_AI_API_KEY")

        # Power BI configuration
        self.powerbi_workspace_id = os.getenv("POWERBI_WORKSPACE_ID")
        self.powerbi_dataset_id = os.getenv("POWERBI_DATASET_ID")

        # Visual types available for Power BI Embedded
        self.visual_types = [
            {"name": "columnChart", "displayName": "Column Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
            {"name": "barChart", "displayName": "Bar Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
            {"name": "pieChart", "displayName": "Pie Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
            {"name": "lineChart", "displayName": "Line Chart", "dataRoles": ["Category", "Series", "Y"]},
            {"name": "areaChart", "displayName": "Area Chart", "dataRoles": ["Category", "Series", "Y"]},
            {"name": "donutChart", "displayName": "Donut Chart", "dataRoles": ["Category", "Y", "Tooltips"]},
        ]

        # Power BI data model schema
        self.data_model_schema =  """
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

config = Config()