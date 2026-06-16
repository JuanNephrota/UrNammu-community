import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ReportResult } from "../types";
import { formatCell } from "./format";

// Brand palette (UrNammu). PDFs render on white for print, so we use the
// deep navy + cyan accent as ink rather than the dark-theme surfaces.
const INK = "#0a0f1c";
const ACCENT = "#0891b2"; // cyan-600 — legible on white
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const ZEBRA = "#f8fafc";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 36, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  headerBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: ACCENT, paddingBottom: 8, marginBottom: 14 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1 },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  description: { fontSize: 9, color: MUTED, marginBottom: 8 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 12 },
  metaChip: { fontSize: 7.5, color: MUTED, backgroundColor: ZEBRA, borderWidth: 1, borderColor: BORDER, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 5, marginRight: 4, marginBottom: 4 },
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 4 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  trZebra: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: ZEBRA },
  th: { flexGrow: 1, flexBasis: 0, paddingVertical: 5, paddingHorizontal: 6, fontFamily: "Helvetica-Bold", fontSize: 8, color: "#ffffff" },
  thRow: { flexDirection: "row", backgroundColor: INK },
  td: { flexGrow: 1, flexBasis: 0, paddingVertical: 4, paddingHorizontal: 6, fontSize: 8 },
  tdNum: { flexGrow: 1, flexBasis: 0, paddingVertical: 4, paddingHorizontal: 6, fontSize: 8, textAlign: "right" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6, fontSize: 7.5, color: MUTED },
  empty: { padding: 16, textAlign: "center", color: MUTED },
});

interface PdfMeta {
  name: string;
  description?: string | null;
  generatedBy?: string | null;
}

function isNumeric(type: string) {
  return type === "number" || type === "currency";
}

function ReportDocument({ result, meta }: { result: ReportResult; meta: PdfMeta }) {
  const generatedAt = new Date(result.generatedAt);
  const chips: string[] = [
    `Source: ${result.source.label}`,
    `Rows: ${result.totalRows.toLocaleString("en-US")}`,
  ];
  if (result.grouped) chips.push("Grouped summary");
  if (result.dateRangeLabel) chips.push(`Range: ${result.dateRangeLabel}`);
  for (const f of result.appliedFilters) chips.push(f);

  // Cap rows in the PDF to keep documents reasonable; note any truncation.
  const MAX_PDF_ROWS = 500;
  const rows = result.rows.slice(0, MAX_PDF_ROWS);
  const truncated = result.rows.length > MAX_PDF_ROWS;

  return (
    <Document title={meta.name} author="UrNammu">
      <Page size="A4" orientation={result.columns.length > 6 ? "landscape" : "portrait"} style={styles.page} wrap>
        <View style={styles.headerBar} fixed>
          <View>
            <Text style={styles.brand}>URNAMMU</Text>
            <Text style={styles.brandSub}>AI Governance & Compliance</Text>
          </View>
          <Text style={styles.brandSub}>{generatedAt.toISOString().slice(0, 10)}</Text>
        </View>

        <Text style={styles.title}>{meta.name}</Text>
        {meta.description ? <Text style={styles.description}>{meta.description}</Text> : null}

        <View style={styles.metaRow}>
          {chips.map((c, i) => (
            <Text key={i} style={styles.metaChip}>{c}</Text>
          ))}
        </View>

        <View style={styles.table}>
          <View style={styles.thRow} fixed>
            {result.columns.map((c) => (
              <Text key={c.key} style={styles.th}>{c.label}</Text>
            ))}
          </View>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No data matched this report.</Text>
          ) : (
            rows.map((row, ri) => (
              <View key={ri} style={ri % 2 ? styles.trZebra : styles.tr} wrap={false}>
                {result.columns.map((c) => (
                  <Text key={c.key} style={isNumeric(c.type) ? styles.tdNum : styles.td}>
                    {formatCell(row[c.key] ?? null, c.type)}
                  </Text>
                ))}
              </View>
            ))
          )}
        </View>

        {truncated ? (
          <Text style={styles.description}>
            Showing first {MAX_PDF_ROWS.toLocaleString("en-US")} of {result.totalRows.toLocaleString("en-US")} rows. Export CSV or JSON for the full data set.
          </Text>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>
            Generated {generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
            {meta.generatedBy ? ` by ${meta.generatedBy}` : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(
  result: ReportResult,
  meta: PdfMeta
): Promise<Buffer> {
  const buf = await renderToBuffer(<ReportDocument result={result} meta={meta} />);
  return buf as Buffer;
}
