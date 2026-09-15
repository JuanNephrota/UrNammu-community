# Reports

Build, export, and schedule custom reports across your governance data. Authoring requires `ADMIN` or `COMPLIANCE_OFFICER`. Any signed-in user can open a report marked `SHARED`.

## Starting from a template

Ten templates cover the common asks: **Usage by Person**, **Cost by Department**, **Risk Posture**, **Compliance Status**, **Usage & Cost**, **Shadow AI Inventory**, **AI System Inventory**, **Executive Summary**, **Alerts Activity**, and **Audit Trail**. A template is a starting configuration, not a fixed format — every column, filter, and grouping stays editable afterward.

## Data sources

Each report draws from exactly one source:

`AI Systems` · `AI Agents` · `Risk Assessments` · `Compliance` · `API Usage & Cost` · `Alerts` · `Shadow AI` · `Audit Log` · `Usage by Person`

Columns are typed — string, enum, number, or date — and the builder offers filters appropriate to the type. Numeric columns on assessment and cost sources can be aggregated (for example, average risk score by department) rather than listed row by row.

**Usage by Person** is a computed source: one row per person with their Claude Code, Cowork, Cursor, and proxied-API cost and activity merged by email (the same data as **Oversight → Usage by Person**). Every column can be filtered, sorted, and grouped — group by **Department** to get spend per team — and the date range sets the activity window.

## Building a report

Pick a data source → choose columns → add filters → shape the output (grouping, sorting, limits) → preview. The **Preview** tab runs the real query against live data, so what you see is what a scheduled run will produce.

## Report detail tabs

- **Preview** — current output, re-queried on load.
- **Run history** — every past run with its artifact, so you can show an auditor the figures as they stood on a given date.
- **Schedules** — recurring delivery, described below.

## Export formats

`PDF` for circulation, `CSV` for spreadsheet analysis, `JSON` for downstream tooling. PDF renders the shaped and grouped layout; CSV and JSON carry the underlying rows.

Stored run artifacts are capped at 5 MB. A larger run still succeeds and still downloads, but is not persisted for later re-download from **Run history** — narrow the filters or the date range if you need the artifact kept.

## Scheduled delivery

Schedules run `DAILY`, `WEEKLY`, or `MONTHLY` and email the chosen format to a recipient list. Email delivery must be configured first at **Settings → Reporting**; without it, schedules save but never send.

A scheduled run queries data at send time, so a monthly report reflects the month it was sent, not the month it was authored. Use **Run history** to compare successive periods.

## Access

Each definition is either `PRIVATE` or `SHARED`. `PRIVATE` is visible to its owner and to `ADMIN`; `SHARED` is visible to every signed-in user. Editing and deleting stay with the owner and with any `ADMIN` or `COMPLIANCE_OFFICER`.

Deleting a definition also removes its run history and any schedules attached to it.
