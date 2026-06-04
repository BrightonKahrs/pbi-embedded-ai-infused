---
name: chart-suggestion
description: Maps a DAX query result shape and the user's question into a sensible Power BI visual configuration suitable for an inline chat preview. Used by the visual creator agent when answering chat questions.
license: MIT
metadata:
  version: "1.0.0"
  applies_to: chat-inline-visualizations
---

# Chart Suggestion Skill

You convert a small DAX result set into a clean Power BI visual config
that previews well as an *inline* chart inside a chat bubble. Aim for a
visual a non-technical user would expect by default.

## Inputs you'll see

A user question like *"show me sales by category"* plus the column
names that appeared in the DAX result. Column keys returned by the
Power BI `executeQueries` API look like:

- `Table[Column]`  → a categorical or numeric column
- `[Measure Name]` → a measure (always numeric)

## Decision rules

1. **Pick exactly one categorical field** for the `Category` data role.
   Prefer the first non-numeric column key (e.g. `Category[Category]`,
   `Calendar[Year]`, `Orders[Region]`).
2. **Pick exactly one numeric field** for the `Y` data role. Prefer the
   first measure (`[Total Sales]`) or numeric column.
3. **Choose the visual type** based on the category column and row
   count:
   - Time-ordered category (`Calendar[Year]`, `Calendar[Date]`,
     `Calendar[Month]`, `Calendar[Quarter]`) → `lineChart`.
   - Few discrete labels (≤ 5 rows) like product category, segment,
     region → `columnChart` (preferred) or `pieChart` if the user said
     "share", "proportion", "breakdown", or "%".
   - Many labels (> 8 rows) → `barChart` so labels stay readable.
   - Otherwise default to `columnChart`.
4. **Title the visual after the user's question.** Use Title Case and
   keep it under ~50 chars (e.g. "Sales by Category", "Sales by Month").
5. **Properties defaults**: `showLegend=false`, `showXAxis=true`,
   `showYAxis=true`. Turn `showLegend=true` only for pie/donut charts.
6. **Skip the chart** when:
   - The result is a single scalar (one row, one number)
   - The result has > 50 rows (too dense for a chat preview)
   - The result lacks any obvious categorical column

## Examples

### Sales by Category (3 categorical rows + 1 measure)
```json
{
  "visualType": "columnChart",
  "title": "Sales by Category",
  "dataFields": [
    {"dataRole": "Category", "table": "Category", "column": "Category", "isMeasure": false},
    {"dataRole": "Y", "table": "Mesures", "column": "Total Sales", "isMeasure": true}
  ],
  "properties": {"showLegend": false, "showXAxis": true, "showYAxis": true}
}
```

### Sales over Months (12 rows, time-ordered)
```json
{
  "visualType": "lineChart",
  "title": "Sales by Month",
  "dataFields": [
    {"dataRole": "Category", "table": "Calendar", "column": "Month", "isMeasure": false},
    {"dataRole": "Y", "table": "Mesures", "column": "Total Sales", "isMeasure": true}
  ],
  "properties": {"showLegend": false, "showXAxis": true, "showYAxis": true}
}
```

### Top Customers by Sales (10 rows, many labels)
```json
{
  "visualType": "barChart",
  "title": "Top Customers by Sales",
  "dataFields": [
    {"dataRole": "Category", "table": "Orders", "column": "Customer Name", "isMeasure": false},
    {"dataRole": "Y", "table": "Mesures", "column": "Total Sales", "isMeasure": true}
  ],
  "properties": {"showLegend": false, "showXAxis": true, "showYAxis": true}
}
```

## Important constraints

- Always set `isMeasure=true` when the field comes from the `Mesures`
  table; otherwise `false`.
- Use the *exact* table and column names from the documented data
  model. Do not invent fields.
- Emit the visual config as **valid JSON only**, with no commentary.
