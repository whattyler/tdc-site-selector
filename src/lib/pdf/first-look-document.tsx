/* eslint-disable jsx-a11y/alt-text --
   These are @react-pdf/renderer <Image> elements, not HTML <img>. A PDF has no
   alt attribute, and the rule cannot tell the two apart by name alone. */
import path from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  ANSWER_LABELS,
  BUCKET_LABELS,
  BUCKET_ORDER,
} from "@/lib/criteria-labels";
import { bps, compact, money, percent, score as fmtScore } from "@/lib/format";
import type { EvaluatedDeal } from "@/lib/deals/evaluate";
import type { DealSnapshot } from "@/lib/deals/snapshot";
import type { Answer, Assumptions } from "@/lib/scoring";

/**
 * The First Look report. Spec B5 §7, Phase 8.
 *
 * Two pages, deliberately. Page 1 answers "is this a Toro deal" and page 2
 * answers "does the money work". Anything that does not serve one of those two
 * questions is on the screen, not in the report.
 *
 * Print is not the screen. The dark slate the app uses would drink a toner
 * cartridge and read badly on paper, so the report inverts to white with the
 * same brand red rules and the same two typefaces.
 */

const FONT_DIR = path.join(process.cwd(), "src", "lib", "pdf", "fonts");

let registered = false;

/** Registered once per process; react-pdf keeps a module-level font store. */
export function registerFonts(): void {
  if (registered) return;

  Font.register({
    family: "Alegreya",
    fonts: [
      { src: path.join(FONT_DIR, "Alegreya-SemiBold.woff"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Alegreya-Bold.woff"), fontWeight: 700 },
    ],
  });

  Font.register({
    family: "Carlito",
    fonts: [
      { src: path.join(FONT_DIR, "Carlito-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Carlito-Bold.ttf"), fontWeight: 700 },
    ],
  });

  // Long addresses and comp names have no spaces to break on otherwise.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

const RED = "#C7202E";
const INK = "#1B1F24";
const INK_2 = "#4A535D";
const INK_3 = "#7A838D";
const RULE = "#D6D9DC";
const ZEBRA = "#F5F6F7";
const AMBER = "#B8860B";
const SLATE = "#6B747E";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 34,
    paddingHorizontal: 36,
    fontFamily: "Carlito",
    fontSize: 8.5,
    color: INK,
    backgroundColor: "#FFFFFF",
  },

  headerRow: { flexDirection: "row", alignItems: "flex-end" },
  logo: { width: 104, height: 21 },
  wordmark: {
    fontFamily: "Alegreya",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.6,
    marginLeft: 8,
    color: INK,
  },
  headerRight: { marginLeft: "auto", textAlign: "right", color: INK_3, fontSize: 7.5 },
  redRule: { height: 2, backgroundColor: RED, marginTop: 6, marginBottom: 12 },
  rule: { height: 1, backgroundColor: RULE, marginTop: 8, marginBottom: 8 },

  dealName: { fontFamily: "Alegreya", fontWeight: 700, fontSize: 19, color: INK },
  address: { fontSize: 9, color: INK_2, marginTop: 2 },

  columns: { flexDirection: "row", gap: 14, marginTop: 12 },
  aerial: { width: 232, height: 150, objectFit: "cover", border: `1 solid ${RULE}` },
  aerialMissing: {
    width: 232,
    height: 150,
    border: `1 solid ${RULE}`,
    color: INK_3,
    fontSize: 8,
    padding: 8,
  },

  sectionHead: {
    fontFamily: "Alegreya",
    fontWeight: 600,
    fontSize: 10.5,
    color: INK,
    marginBottom: 4,
  },
  bucketHead: {
    fontFamily: "Alegreya",
    fontWeight: 600,
    fontSize: 8,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: INK_2,
  },
  micro: {
    fontSize: 6.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: INK_3,
  },

  verdictWord: { fontFamily: "Alegreya", fontWeight: 700, fontSize: 16 },
  gateLabel: { fontSize: 6.5, letterSpacing: 0.6, textTransform: "uppercase", color: INK_3 },
  gateDetail: { fontSize: 7.5, color: INK_2, marginTop: 1 },

  row: { flexDirection: "row", alignItems: "center", minHeight: 13 },
  zebra: { backgroundColor: ZEBRA },
  cell: { paddingVertical: 2, paddingRight: 4 },
  numCell: { paddingVertical: 2, paddingRight: 4, textAlign: "right" },

  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 16,
    flexDirection: "row",
    fontSize: 6.5,
    color: INK_3,
    borderTopWidth: 1,
    borderTopColor: RULE,
    paddingTop: 4,
  },
});

function verdictColour(verdict: string): string {
  if (verdict === "DOUBLE GO" || verdict === "GO") return RED;
  if (verdict === "NO-GO" || verdict === "NOT SCORED") return SLATE;
  return AMBER;
}

const FALLBACK_ANSWER: Record<NonNullable<Answer>, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** The words the screen used, so the report cannot say something else. */
function answerLabel(key: string, answer: NonNullable<Answer>): string {
  const labels = ANSWER_LABELS[key];
  if (!labels) return FALLBACK_ANSWER[answer];
  return labels[answer === "yes" ? 0 : answer === "maybe" ? 1 : 2];
}

function landTestLabel(value: string): string {
  if (value === "PASS") return "CLEAR";
  if (value === "FAIL") return "SHORT";
  return value;
}

export interface FirstLookPdfProps {
  snapshot: DealSnapshot;
  evaluated: EvaluatedDeal;
  assumptions: Assumptions;
  /** Static Maps aerial as a data URI, or null if it could not be fetched. */
  aerial: string | null;
  /** Toro logo as a data URI. */
  logo: string | null;
  assumptionsOrigin: string;
  generatedAt: Date;
  generatedBy: string;
}

function PageFrame({
  children,
  dealName,
  generatedAt,
  page,
  assumptionsOrigin,
}: {
  children: React.ReactNode;
  dealName: string;
  generatedAt: Date;
  page: number;
  assumptionsOrigin: string;
}) {
  return (
    <>
      {children}
      <View style={styles.footer} fixed>
        <Text>
          {dealName} · First Look · generated{" "}
          {generatedAt.toISOString().slice(0, 10)} · assumptions from{" "}
          {assumptionsOrigin}
        </Text>
        <Text style={{ marginLeft: "auto" }}>Page {page} of 2</Text>
      </View>
    </>
  );
}

export function FirstLookDocument({
  snapshot,
  evaluated,
  assumptions,
  aerial,
  logo,
  assumptionsOrigin,
  generatedAt,
  generatedBy,
}: FirstLookPdfProps) {
  const { deal } = snapshot;
  const { screen, demographics, revenue, costs, firstLook, gate2, combined } =
    evaluated;
  const dealName = deal.name || "Untitled deal";

  const criteria = screen.rows;
  // Fixed order, not whatever order the rows happen to arrive in.
  const buckets = BUCKET_ORDER.filter((bucket) =>
    criteria.some((row) => row.bucket === bucket),
  );

  return (
    <Document
      title={`${dealName} — First Look`}
      author="Toro Development Company"
      subject="Deal screen and First Look underwriting"
    >
      {/* ── Page 1 — is this a Toro deal? ─────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageFrame
          dealName={dealName}
          generatedAt={generatedAt}
          page={1}
          assumptionsOrigin={assumptionsOrigin}
        >
          <View style={styles.headerRow}>
            {logo && <Image src={logo} style={styles.logo} />}
            <Text style={styles.wordmark}>SITE SELECTOR</Text>
            <View style={styles.headerRight}>
              <Text>First Look</Text>
              <Text>
                {generatedAt.toISOString().slice(0, 10)} · {generatedBy}
              </Text>
            </View>
          </View>
          <View style={styles.redRule} />

          <Text style={styles.dealName}>{dealName}</Text>
          <Text style={styles.address}>
            {deal.address || "No address"}
            {deal.submarket ? ` · ${deal.submarket}` : ""}
            {deal.acreage ? ` · ${deal.acreage} ac` : ""}
          </Text>

          <View style={styles.columns}>
            {aerial ? (
              <Image src={aerial} style={styles.aerial} />
            ) : (
              <View style={styles.aerialMissing}>
                <Text>
                  No aerial. The deal has no geocoded point, or the Static Maps
                  request failed.
                </Text>
              </View>
            )}

            <View style={{ flex: 1 }}>
              {/* The three lines, in the order the panel gives them. */}
              <View>
                <Text style={styles.gateLabel}>Gate 1 · Deal screen</Text>
                <Text
                  style={[
                    styles.verdictWord,
                    { color: verdictColour(screen.verdict) },
                  ]}
                >
                  {screen.verdict}
                </Text>
                <Text style={styles.gateDetail}>
                  screen {fmtScore(screen.weightedScore)} / 100 · KO{" "}
                  {screen.koPass.toLowerCase()} · unknown{" "}
                  {percent(screen.unknownShare, 0)} · prob{" "}
                  {screen.probability.toFixed(2)} →{" "}
                  {fmtScore(screen.probabilityWeightedScore)}
                </Text>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.gateLabel}>Gate 2 · First Look</Text>
                <Text
                  style={[
                    styles.verdictWord,
                    { color: verdictColour(gate2 === "PASS" ? "GO" : String(gate2)) },
                  ]}
                >
                  {landTestLabel(String(gate2))}
                </Text>
                <Text style={styles.gateDetail}>
                  {firstLook
                    ? `max land ${money(firstLook.maxLandPrice)} · ask ${
                        firstLook.askingPrice > 0
                          ? money(firstLook.askingPrice)
                          : "not entered"
                      }`
                    : "No First Look figures entered"}
                </Text>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.gateLabel}>Combined</Text>
                <Text
                  style={[styles.verdictWord, { color: verdictColour(combined) }]}
                >
                  {combined}
                </Text>
              </View>

              <View style={styles.rule} />

              <View style={styles.row}>
                <Text style={[styles.cell, { width: 92 }]}>Mixed-Use score</Text>
                <Text style={[styles.numCell, { width: 44 }]}>
                  {snapshot.deal.mu || "—"}
                </Text>
                <Text style={[styles.cell, { width: 62 }]}>Multifamily</Text>
                <Text style={[styles.numCell, { width: 44 }]}>
                  {snapshot.deal.mf || "—"}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.cell, { width: 92 }]}>Governing</Text>
                <Text style={[styles.numCell, { width: 44 }]}>
                  {fmtScore(demographics.governingScore)}
                </Text>
                <Text style={[styles.cell, { width: 62 }]}>Band</Text>
                <Text
                  style={[
                    styles.numCell,
                    { width: 44, color: verdictColour(demographics.band ?? "") },
                  ]}
                >
                  {demographics.band ?? "—"}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Gate 1 table ───────────────────────────────────────── */}
          <View style={styles.rule} />
          <Text style={styles.sectionHead}>
            2026 Deal Filter · {screen.answeredCount} of{" "}
            {assumptions.verdict.requiredAnswered} answered
          </Text>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: INK }]}>
            <Text style={[styles.micro, styles.cell, { flex: 1 }]}>Criterion</Text>
            <Text style={[styles.micro, styles.numCell, { width: 28 }]}>Wt</Text>
            <Text style={[styles.micro, styles.cell, { width: 22 }]}>KO</Text>
            <Text style={[styles.micro, styles.cell, { width: 52 }]}>Answer</Text>
            <Text style={[styles.micro, styles.numCell, { width: 34 }]}>Score</Text>
            <Text style={[styles.micro, styles.cell, { flex: 1.4 }]}>Note</Text>
          </View>

          {buckets.map((bucket) => (
            <View key={bucket} wrap={false}>
              <View style={[styles.row, { backgroundColor: ZEBRA, marginTop: 3 }]}>
                <Text style={[styles.bucketHead, styles.cell, { flex: 1 }]}>
                  {BUCKET_LABELS[bucket]}
                </Text>
              </View>
              {criteria
                .filter((row) => row.bucket === bucket)
                .map((row, index) => (
                  <View
                    key={row.key}
                    style={[styles.row, index % 2 === 1 ? styles.zebra : {}]}
                  >
                    <Text style={[styles.cell, { flex: 1 }]}>{row.label}</Text>
                    <Text style={[styles.numCell, { width: 28 }]}>
                      {row.weight}
                    </Text>
                    <Text style={[styles.cell, { width: 22, color: INK_3 }]}>
                      {row.ko ? "KO" : ""}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        { width: 52, color: row.answer ? INK : INK_3 },
                      ]}
                    >
                      {row.kind === "computed"
                        ? (demographics.band ?? "—")
                        : row.answer
                          ? answerLabel(row.key, row.answer)
                          : "—"}
                    </Text>
                    <Text style={[styles.numCell, { width: 34 }]}>
                      {row.answer || row.kind === "computed"
                        ? fmtScore(row.score)
                        : "—"}
                    </Text>
                    <Text style={[styles.cell, { flex: 1.4, color: INK_2 }]}>
                      {snapshot.notes[row.key] ?? ""}
                    </Text>
                  </View>
                ))}
            </View>
          ))}
        </PageFrame>
      </Page>

      {/* ── Page 2 — does the money work? ─────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <PageFrame
          dealName={dealName}
          generatedAt={generatedAt}
          page={2}
          assumptionsOrigin={assumptionsOrigin}
        >
          <View style={styles.headerRow}>
            <Text style={styles.dealName}>Gate 2 · First Look</Text>
            <Text style={[styles.headerRight, { fontSize: 8 }]}>{dealName}</Text>
          </View>
          <View style={styles.redRule} />

          <View style={{ flexDirection: "row", gap: 18 }}>
            {/* NOI by component */}
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHead}>Stabilized NOI</Text>
              <View
                style={[styles.row, { borderBottomWidth: 1, borderBottomColor: INK }]}
              >
                <Text style={[styles.micro, styles.cell, { flex: 1 }]}>
                  Component
                </Text>
                <Text style={[styles.micro, styles.numCell, { width: 58 }]}>
                  Gross
                </Text>
                <Text style={[styles.micro, styles.numCell, { width: 58 }]}>NOI</Text>
              </View>
              {(["retail", "office", "multifamily"] as const).map((key, index) => (
                <View
                  key={key}
                  style={[styles.row, index % 2 === 1 ? styles.zebra : {}]}
                >
                  <Text style={[styles.cell, { flex: 1 }]}>
                    {key === "multifamily"
                      ? "Multifamily"
                      : key[0].toUpperCase() + key.slice(1)}
                  </Text>
                  <Text style={[styles.numCell, { width: 58, color: INK_2 }]}>
                    {revenue[key].grossRent === null
                      ? "—"
                      : compact(revenue[key].grossRent)}
                  </Text>
                  <Text style={[styles.numCell, { width: 58 }]}>
                    {revenue[key].noi === null ? "—" : compact(revenue[key].noi)}
                  </Text>
                </View>
              ))}
              <View style={[styles.row, { borderTopWidth: 1, borderTopColor: INK }]}>
                <Text style={[styles.cell, { flex: 1, fontWeight: 700 }]}>
                  Total NOI
                </Text>
                <Text style={[styles.numCell, { width: 58, color: INK_3 }]}>
                  {revenue.retailShareOfNoi === null
                    ? ""
                    : `retail ${percent(revenue.retailShareOfNoi, 0)}`}
                </Text>
                <Text style={[styles.numCell, { width: 58, fontWeight: 700 }]}>
                  {revenue.totalNoi === null ? "—" : compact(revenue.totalNoi)}
                </Text>
              </View>
            </View>

            {/* Cost ex-land by subtotal */}
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHead}>Cost excluding land</Text>
              <View
                style={[styles.row, { borderBottomWidth: 1, borderBottomColor: INK }]}
              >
                <Text style={[styles.micro, styles.cell, { flex: 1 }]}>Subtotal</Text>
                <Text style={[styles.micro, styles.numCell, { width: 70 }]}>
                  Amount
                </Text>
              </View>
              {(
                [
                  ["Hard costs", costs?.totals.hard],
                  ["Soft costs", costs?.totals.soft],
                  ["Financing and carry", costs?.totals.other],
                ] as const
              ).map(([label, value], index) => (
                <View
                  key={label}
                  style={[styles.row, index % 2 === 1 ? styles.zebra : {}]}
                >
                  <Text style={[styles.cell, { flex: 1 }]}>{label}</Text>
                  <Text style={[styles.numCell, { width: 70 }]}>
                    {value === undefined ? "—" : compact(value)}
                  </Text>
                </View>
              ))}
              <View style={[styles.row, { borderTopWidth: 1, borderTopColor: INK }]}>
                <Text style={[styles.cell, { flex: 1, fontWeight: 700 }]}>
                  Cost ex-land
                </Text>
                <Text style={[styles.numCell, { width: 70, fontWeight: 700 }]}>
                  {costs === null ? "—" : compact(costs.totals.costExLand)}
                </Text>
              </View>
              <Text style={[styles.micro, { marginTop: 3 }]}>
                Library rates stay on the server. Escalated and multiplied.
              </Text>
            </View>
          </View>

          {/* Land test */}
          <View style={styles.rule} />
          <Text style={styles.sectionHead}>The land</Text>
          <View style={{ flexDirection: "row", gap: 18 }}>
            <View style={{ flex: 1 }}>
              {(
                [
                  ["YoC on cost", firstLook ? percent(firstLook.yocOnCost) : "—"],
                  ["Target blend", firstLook ? percent(firstLook.blendedYoc) : "—"],
                  ["Gap", firstLook ? bps(firstLook.yocGapBps) : "—"],
                  ["Pad proceeds", firstLook ? money(firstLook.padProceeds.total) : "—"],
                ] as const
              ).map(([label, value], index) => (
                <View
                  key={label}
                  style={[styles.row, index % 2 === 1 ? styles.zebra : {}]}
                >
                  <Text style={[styles.cell, { flex: 1 }]}>{label}</Text>
                  <Text style={[styles.numCell, { width: 74 }]}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              {(
                [
                  ["Max land price", firstLook ? money(firstLook.maxLandPrice) : "—"],
                  [
                    "Asking price",
                    firstLook && firstLook.askingPrice > 0
                      ? money(firstLook.askingPrice)
                      : "—",
                  ],
                  [
                    "Gap vs ask",
                    firstLook && firstLook.askingPrice > 0
                      ? `${money(firstLook.headroom)} · ${percent(
                          firstLook.headroomPctOfAsk,
                          0,
                        )}`
                      : "—",
                  ],
                  ["Land test", landTestLabel(String(gate2))],
                ] as const
              ).map(([label, value], index) => (
                <View
                  key={label}
                  style={[styles.row, index % 2 === 1 ? styles.zebra : {}]}
                >
                  <Text style={[styles.cell, { flex: 1 }]}>{label}</Text>
                  <Text
                    style={[
                      styles.numCell,
                      {
                        width: 110,
                        color: label === "Land test" ? verdictColour(
                          gate2 === "PASS" ? "GO" : String(gate2),
                        ) : INK,
                      },
                    ]}
                  >
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Sensitivity */}
          <View style={styles.rule} />
          <Text style={styles.sectionHead}>
            Sensitivity · max land at MF YoC × commercial YoC
          </Text>

          {firstLook ? (
            <View>
              <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: INK }]}>
                {/* Plain ASCII: the box-drawing diagonal the screen uses is
                    not in Carlito, and an unmapped glyph prints as a stray
                    letter rather than as nothing. */}
                <Text style={[styles.micro, styles.cell, { width: 60 }]}>
                  MF \ Comm
                </Text>
                {firstLook.sensitivity.commYocAxis.map((comm) => (
                  <Text key={comm} style={[styles.micro, styles.numCell, { flex: 1 }]}>
                    {percent(comm, 2)}
                  </Text>
                ))}
              </View>
              {firstLook.sensitivity.mfYocAxis.map((mf, mfIndex) => (
                <View
                  key={mf}
                  style={[styles.row, mfIndex % 2 === 1 ? styles.zebra : {}]}
                >
                  <Text style={[styles.micro, styles.cell, { width: 60 }]}>
                    {percent(mf, 2)}
                  </Text>
                  {firstLook.sensitivity.commYocAxis.map((comm, commIndex) => {
                    const value = firstLook.sensitivity.cells[mfIndex][commIndex];
                    const centre =
                      mfIndex === (firstLook.sensitivity.mfYocAxis.length - 1) / 2 &&
                      commIndex ===
                        (firstLook.sensitivity.commYocAxis.length - 1) / 2;
                    return (
                      <Text
                        key={comm}
                        style={[
                          styles.numCell,
                          {
                            flex: 1,
                            fontWeight: centre ? 700 : 400,
                            color:
                              firstLook.askingPrice > 0
                                ? value >= firstLook.askingPrice
                                  ? RED
                                  : AMBER
                                : INK,
                          },
                        ]}
                      >
                        {compact(value)}
                      </Text>
                    );
                  })}
                </View>
              ))}
              <Text style={[styles.micro, { marginTop: 3 }]}>
                {firstLook.askingPrice > 0
                  ? `Red clears the ${money(firstLook.askingPrice)} ask, amber falls short. Bold is the current pair.`
                  : "No asking price entered, so nothing is coloured against one. Bold is the current pair."}
              </Text>
            </View>
          ) : (
            <Text style={{ color: INK_3 }}>
              No First Look figures, so there is nothing to vary.
            </Text>
          )}
        </PageFrame>
      </Page>
    </Document>
  );
}
