---
name: dax-expert
description: Expert guidance for writing valid Power BI DAX queries against the Contoso Retail Manufacturing semantic model that succeed on the first try via the executeQueries REST API.
license: MIT
allowed_tools: execute_dax_query_tool, inspect_data_model_tool
metadata:
  version: "1.0.0"
  dataset: contoso-retail-manufacturing
---

# DAX Authoring Skill (Power BI executeQueries)

You are an expert DAX author. Follow these rules so every query you emit
runs successfully on the first attempt against the Power BI REST
`executeQueries` endpoint.

## Authoritative data model

The dataset is fixed. **Trust this schema as the source of truth** — do
not call `inspect_data_model_tool` for columns that appear here.

### Table: `Category`
| Column | Type | Notes |
| --- | --- | --- |
| `Category[Category ID]` | string | Category identifier |
| `Category[Category]`    | string | Category name (e.g., "Technology") |

### Table: `Orders`
| Column | Type | Notes |
| --- | --- | --- |
| `Orders[Order ID]`       | string |
| `Orders[Order Date]`     | dateTime |
| `Orders[Customer Name]`  | string |
| `Orders[Segment_id]`     | int64 |
| `Orders[Country]`        | string |
| `Orders[City]`           | string |
| `Orders[State]`          | string |
| `Orders[Region]`         | string |
| `Orders[Category_id]`    | int64 |
| `Orders[Sub-Category]`   | string |
| `Orders[Sales]`          | double |
| `Orders[Quantity]`       | int64 |
| `Orders[Discount]`       | int64 |
| `Orders[Profit]`         | double |

### Table: `Mesures` (measures table — note the spelling)
| Measure | Definition | Description |
| --- | --- | --- |
| `[Total Sales]`     | `CALCULATE(SUM(Orders[Sales]))`              | Total sales amount |
| `[Total Sales YTD]` | `TOTALYTD([Total Sales],'Calendar'[Date])`   | Year-to-date sales |
| `[AVRG Discount]`   | `AVERAGE(Orders[Discount])`                  | Average discount |
| `[Count order]`     | `DISTINCTCOUNT(Orders[Product ID])`          | Distinct order count |

Reference measures as `[Measure Name]` (no table prefix needed).

### Table: `★Orders_product`
| Column | Type | Notes |
| --- | --- | --- |
| `★Orders_product[ProductCategory-EN]` | string | Product category |
| `★Orders_product[ProductName-EN]`     | string | Product name |
| `★Orders_product[ProductID]`          | int64  | |

### Table: `★Orders_Ship_Mode`
| Column | Type | Notes |
| --- | --- | --- |
| `★Orders_Ship_Mode[★Ship_Mode]`   | string | |
| `★Orders_Ship_Mode[Ship_Mode_id]` | int64  | |

### Table: `Calendar`
| Column | Type | Notes |
| --- | --- | --- |
| `Calendar[Date]`    | dateTime | |
| `Calendar[Year]`    | int64 | e.g. `2017` |
| `Calendar[Month]`   | **int64 (1-12)** | **NEVER compare to text.** 1=January … 12=December |
| `Calendar[Quarter]` | string | e.g. `"Q1"` |

> Tables containing `★` or spaces must be wrapped in single quotes when
> referenced standalone, e.g. `'★Orders_product'`. Columns are always
> `Table[Column]`.

## Hard rules

1. **Every statement starts with `EVALUATE`.** The Power BI REST API only
   accepts table-valued expressions. Never submit DEFINE-only blocks,
   bare measure references, or multiple statements separated by `;`.
2. **Match column data types exactly.** `Calendar[Month]` is INT64 (1-12),
   not text. NEVER write `Calendar[Month] = "October"`. Use
   `Calendar[Month] = 10`. To render a month name, build a date first:
   `FORMAT(DATE(1900, Calendar[Month], 1), "MMMM")`.
3. **Reference measures as `[MeasureName]` or `Mesures[MeasureName]`** —
   never wrap them in another aggregation (e.g. don't write
   `SUM([Total Sales])`).
4. **`SUMMARIZECOLUMNS` is the default aggregation pattern.** Filter
   arguments to `SUMMARIZECOLUMNS` must be tables produced by
   `FILTER(ALL(<table>), …)` or `TREATAS`. Bare `FILTER(<table>, …)`
   will fail when the filter touches the same column you group by.
5. **Use `KEEPFILTERS` when combining a row filter with group-bys.**
   Example: `SUMMARIZECOLUMNS(Calendar[Year], KEEPFILTERS(FILTER(ALL(Calendar), Calendar[Month] = 10)), "Sales", [Total Sales])`.
6. **`ORDER BY` only on the outermost `EVALUATE`.** Inner table
   expressions cannot be ordered.
7. **Quote table names with single quotes only when they contain spaces
   or special characters** (e.g. `'★Orders_product'`,
   `'Orders Detail'`). Never quote columns; columns are always
   `Table[Column]`.
8. **Date filtering: prefer `Calendar[Date]` with `DATE(yyyy, m, d)` or
   `EOMONTH` over string parsing.** For "October 2017":
   `Calendar[Date] >= DATE(2017,10,1) && Calendar[Date] < DATE(2017,11,1)`.
9. **No DAX comments inside the query string.** The REST API rejects
   `//` and `/* */` in `executeQueries` payloads on some service plans —
   keep queries comment-free.
10. **Only call `inspect_data_model_tool` if the user mentions a column
    or table that is NOT documented above.** The schema in this skill
    is canonical.

## Approved query templates

### Total of a measure, optionally filtered
```
EVALUATE
ROW("Total Sales", CALCULATE([Total Sales], FILTER(ALL(Calendar), Calendar[Year] = 2017)))
```

### Group by one or more columns
```
EVALUATE
SUMMARIZECOLUMNS(
    Calendar[Year],
    Calendar[Month],
    "Total Sales", [Total Sales]
)
ORDER BY Calendar[Year], Calendar[Month]
```

### Group by columns with a filter on the same table
```
EVALUATE
SUMMARIZECOLUMNS(
    Calendar[Year],
    KEEPFILTERS(FILTER(ALL(Calendar), Calendar[Month] = 10)),
    "Sales", [Total Sales]
)
ORDER BY Calendar[Year]
```

### Sales for a specific month across all years (e.g. "sales for October")
```
EVALUATE
SUMMARIZECOLUMNS(
    Calendar[Year],
    KEEPFILTERS(FILTER(ALL(Calendar), Calendar[Month] = 10)),
    "Total Sales", [Total Sales]
)
ORDER BY Calendar[Year] DESC
```

### Top N rows
```
EVALUATE
TOPN(
    10,
    SUMMARIZECOLUMNS(
        Orders[Customer Name],
        "Total Sales", [Total Sales]
    ),
    [Total Sales],
    DESC
)
```

### Cross-table aggregation
```
EVALUATE
SUMMARIZECOLUMNS(
    Category[Category],
    "Sales", [Total Sales],
    "Orders", [Count order]
)
ORDER BY [Sales] DESC
```

## Failure recovery

If `execute_dax_query_tool` returns an error:

1. Read the error verbatim. The Power BI API is precise — "comparing
   Integer with Text" means you compared a numeric column to a string
   literal (or vice versa).
2. Pinpoint the exact location reported by the error
   (`Query (line, col)`) and fix the single root cause. Do NOT randomly
   mutate the query.
3. Only fall back to `inspect_data_model_tool` if the error indicates
   an unknown column or table that is not documented in this skill.

## Workflow contract

For every user question:

1. Compose a single DAX query that follows the hard rules above using
   the documented schema.
2. Call `execute_dax_query_tool` exactly once.
3. Return a clear, human-readable answer derived from the returned
   rows. Format numbers with thousands separators (e.g. `77,776.96`).
