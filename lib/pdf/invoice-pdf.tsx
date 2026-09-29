import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LABELS, type Lang } from "./labels";

export type PdfAccount = {
  label: string;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankAddress: string;
  bankCode: string;
  branchCode: string;
  swiftCode: string;
  accountLocation: string;
};

export type InvoicePdfData = {
  lang: Lang;
  issuer: { name: string; addressLines: string[]; logo: Buffer | null };
  billTo: { name: string; attention: string; lines: string[] };
  number: string;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  lines: { description: string; detail: string; rate: number; quantity: number; amount: number }[];
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  alt: { currency: string; amount: number } | null;
  terms: string[];
  account: PdfAccount | null;
  extraAccounts: PdfAccount[];
};

// Geometry mirrors the Excel template's Letter export, in points.
const SYMBOL: Record<string, string> = { USD: "$", HKD: "HK$", CNY: "¥", EUR: "€", SGD: "S$" };
const BLUE = "#4285F4";
const FONT = ["Helvetica", "NotoSansSC"];
const ROW = 11.4;
const BODY = 9.22;
const LABEL = 8.26;
const COL = { rate: 88.8, qty: 38.4, total: 91.1 };
// Excel bottom-aligns text: every row's baseline sits 8.8pt below its top. react-pdf puts it at
// top + 0.9 × font size, so each style pads the difference and shortens its line box to match.
const rowText = (size: number, row = ROW) => {
  const pad = 8.8 - size * 0.9;
  return { fontSize: size, paddingTop: pad, lineHeight: (row - pad) / size };
};

// Invoices with up to this many lines always fit one page: the template's empty space under the
// lines and above Terms gives way when the content below would otherwise spill over.
const ONE_PAGE_LINES = 3;
const PAGE_BOTTOM = 20;
const LINES_AREA = 159.9;
const TERMS_GAP = 45.6;
const DESC_WIDTH = 245.8;

/** Rough printed width, enough to reserve rows for wrapped descriptions. */
function wrappedRows(text: string) {
  let width = 0;
  for (const ch of text) width += BODY * (/[\u2e80-\uffef]/.test(ch) ? 1 : 0.56);
  return Math.max(1, Math.ceil(width / DESC_WIDTH));
}

const num = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

const s = StyleSheet.create({
  page: { fontFamily: FONT as never, fontSize: BODY, color: "#000", paddingTop: 36, paddingBottom: 36, paddingLeft: 61.6, paddingRight: 79 },
  body: rowText(BODY),
  label: { ...rowText(LABEL), fontWeight: 700, color: BLUE },
  row: { flexDirection: "row", minHeight: ROW },
  cell: { paddingHorizontal: 1.3 },

  head: { flexDirection: "row", justifyContent: "space-between", height: 90 },
  logo: { width: 251, height: 44.2, objectFit: "contain", objectPositionX: 0, marginLeft: 0.2, marginTop: 8.1 } as never,
  issuer: { fontSize: 9.58, lineHeight: 12 / 9.58, textAlign: "right", paddingRight: 2 },

  billing: { flexDirection: "row", justifyContent: "space-between", marginTop: 4.9, minHeight: 92.2 },
  billLine: rowText(BODY, 11.7),
  bigAmount: { flexDirection: "row", justifyContent: "space-between", width: 122, marginTop: 13.2, paddingLeft: 3.8, paddingRight: 2 },
  bigText: { fontSize: 18.33, fontWeight: 700 },

  metaBar: { flexDirection: "row", backgroundColor: "#000", height: 11.5 },
  metaCell: { justifyContent: "flex-end" },
  metaHead: { ...rowText(LABEL), fontWeight: 700, color: "#FFF", textAlign: "center" },
  metaValue: { ...rowText(LABEL), fontWeight: 700, color: BLUE, textAlign: "center" },

  tableHead: { flexDirection: "row", backgroundColor: "#F2F2F2", height: 11.5, marginTop: 14.9 },
  lines: { paddingTop: ROW, borderBottomWidth: 0.84, borderBottomColor: "#000" },
  line: { flexDirection: "row", paddingBottom: ROW },
  desc: { flex: 1, paddingLeft: 1.3, paddingRight: 6 },

  totals: { marginTop: 11 },
  totalLabel: { width: COL.rate, textAlign: "right", paddingRight: 1.8 },
  totalsRule: { marginLeft: 217.9, borderTopWidth: 0.84, borderTopColor: "#A6A6A6", marginTop: 11, marginBottom: 11 },

  payBar: { backgroundColor: "#D9D9D9", height: 11.5, marginTop: 11.4 },
  kvKey: { width: 95.6, minWidth: 95.6, flexShrink: 0, paddingLeft: 1.3 },
  box: { borderWidth: 0.84, borderColor: BLUE, width: 126.5, paddingLeft: 5.8, paddingRight: 4, paddingTop: 2.7, paddingBottom: 8.4, marginBottom: 8 },
  boxTitle: { fontSize: 8.28, lineHeight: 10.6 / 8.28, fontWeight: 700, color: BLUE, marginBottom: 10.7 },
  boxText: { fontSize: 9.16, lineHeight: 10.6 / 9.16 },
});

/** Excel accounting format: symbol flush left, negatives in parentheses, zero as a dash. */
function Accounting({ value, currency, width, symbolPad, rightPad, size = BODY, bold }: { value: number; currency: string; width: number; symbolPad: number; rightPad: number; size?: number; bold?: boolean }) {
  const text = { ...rowText(size), fontWeight: bold ? 700 : 400 } as const;
  const zero = Math.abs(value) < 0.005;
  return (
    <View style={{ width, flexDirection: "row", justifyContent: "space-between", paddingLeft: symbolPad, paddingRight: rightPad }}>
      <Text style={text}>{SYMBOL[currency] ?? currency}</Text>
      <Text style={text}>
        {zero ? "-" : value < 0 ? `(${num(-value)})` : num(value)}
        <Text style={{ color: "#FFF" }}>{zero ? "00)" : value < 0 ? "" : ")"}</Text>
      </Text>
    </View>
  );
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const L = LABELS[data.lang];
  const amountDue = data.total - data.amountPaid;
  const headline = data.alt ?? { currency: data.currency, amount: amountDue };
  const accountRows = (a: PdfAccount) =>
    [
      [L.currency, a.label],
      [L.accountName, a.accountName],
      [L.accountNumber, a.accountNumber],
      [L.bankName, a.bankName],
      [L.bankAddress, a.bankAddress],
      [L.bankCode, a.bankCode],
      [L.branchCode, a.branchCode],
      [L.swiftCode, a.swiftCode],
      [L.accountLocation, a.accountLocation],
    ].filter(([, v]) => v);
  const onePage = data.lines.length <= ONE_PAGE_LINES;
  const linesHeight = ROW + 0.84 + data.lines.reduce((h, l) => h + (wrappedRows(l.description) + wrappedRows(l.detail || " ") + 1) * ROW, 0);
  const fixed = { flexShrink: 0 } as const;
  const payWidth = data.extraAccounts.length > 0 ? 320 : 471.4;
  const meta = [
    [L.invoiceNumber, data.number, 128.1],
    [L.reference, data.reference, 125],
    [L.dateOfIssue, data.invoiceDate, 127.2],
    [L.dueDate, data.dueDate, 91.1],
  ] as const;
  const totalRow = (label: string, value: number, currency: string, strong = false) => (
    <View style={s.row} key={label}>
      <View style={{ flex: 1 }} />
      <Text style={[strong ? s.label : s.body, s.totalLabel]}>{label}</Text>
      <View style={{ width: COL.qty }} />
      <Accounting value={value} currency={currency} width={COL.total} symbolPad={5.8} rightPad={2} />
    </View>
  );

  return (
    <Document title={`Invoice ${data.number}`} author={data.issuer.name}>
      <Page size="LETTER" style={onePage ? [s.page, { paddingBottom: PAGE_BOTTOM }] : s.page}>
        <View style={onePage ? { height: 792 - 36 - PAGE_BOTTOM } : undefined}>
        <View style={[s.head, fixed]}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {data.issuer.logo && <Image src={data.issuer.logo} style={s.logo} />}
          </View>
          <View style={{ maxWidth: 260, marginTop: 2.3, alignItems: "flex-end" }}>
            <Text style={[s.issuer, { fontWeight: 700 }]}>{data.issuer.name}</Text>
            {data.issuer.addressLines.map((l, i) => (
              <Text key={i} style={s.issuer}>
                {l}
              </Text>
            ))}
          </View>
        </View>

        <View style={[s.billing, fixed]}>
          <View style={[s.cell, { maxWidth: 300 }]}>
            <Text style={s.label}>{L.billedTo}</Text>
            <Text style={s.billLine}>{data.billTo.name}</Text>
            {data.billTo.attention ? <Text style={s.billLine}>{data.billTo.attention}</Text> : null}
            {data.billTo.lines.map((l, i) => (
              <Text key={i} style={s.billLine}>
                {l}
              </Text>
            ))}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.label, { paddingRight: 2 }]}>{L.amountDue(headline.currency)}</Text>
            <View style={s.bigAmount}>
              <Text style={s.bigText}>{SYMBOL[headline.currency] ?? headline.currency}</Text>
              <Text style={s.bigText}>{num(headline.amount)}</Text>
            </View>
          </View>
        </View>

        <View style={[s.metaBar, fixed]}>
          {meta.map(([label, , width]) => (
            <View key={label} style={[s.metaCell, { width }]}>
              <Text style={s.metaHead}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={[s.row, fixed]}>
          {meta.map(([label, value, width]) => (
            <Text key={label} style={[s.metaValue, { width }]}>
              {value}
            </Text>
          ))}
        </View>

        <View style={[s.tableHead, fixed]}>
          <Text style={[s.label, s.desc]}>{L.description}</Text>
          <Text style={[s.label, { width: COL.rate, textAlign: "center" }]}>{L.rate}</Text>
          <Text style={[s.label, { width: COL.qty, textAlign: "center" }]}>{L.qty}</Text>
          <Text style={[s.label, { width: COL.total, textAlign: "center" }]}>{L.lineTotal}</Text>
        </View>
        <View
          style={[
            s.lines,
            onePage ? { flexBasis: Math.max(LINES_AREA, linesHeight), flexShrink: 1, minHeight: linesHeight } : { minHeight: LINES_AREA },
          ]}
        >
          {data.lines.map((l, i) => (
            <View key={i} style={s.line} wrap={false}>
              <View style={s.desc}>
                <Text style={s.body}>{l.description}</Text>
                <Text style={s.body}>{l.detail || " "}</Text>
              </View>
              <Accounting value={l.rate} currency={data.currency} width={COL.rate} symbolPad={3.8} rightPad={1.9} />
              <Text style={[s.body, { width: COL.qty, textAlign: "right", paddingRight: 4.1 }]}>{num(l.quantity, 3)}</Text>
              <Accounting value={l.amount} currency={data.currency} width={COL.total} symbolPad={5.8} rightPad={2} />
            </View>
          ))}
        </View>

        <View style={[s.totals, fixed]} wrap={false}>
          {totalRow(L.subtotal, data.subtotal, data.currency)}
          {totalRow(L.tax, data.tax, data.currency)}
          <View style={s.totalsRule} />
          {totalRow(L.total, data.total, data.currency)}
          {totalRow(L.amountPaid, data.amountPaid, data.currency)}
          <View style={{ height: ROW }} />
          {totalRow(L.amountDue(data.currency), amountDue, data.currency, true)}
          {data.alt && totalRow(L.amountDue(data.alt.currency), data.alt.amount, data.alt.currency, true)}
        </View>

        {data.terms.length > 0 && <View style={{ flexBasis: TERMS_GAP, flexShrink: onePage ? 1 : 0, minHeight: ROW }} />}
        {data.terms.length > 0 && (
          <View style={fixed} wrap={false}>
            <Text style={[s.label, s.cell]}>{L.terms}</Text>
            {data.terms.map((t, i) => (
              <Text key={i} style={[s.body, s.cell]}>
                {/^[•·-]/.test(t) ? t : `• ${t}`}
              </Text>
            ))}
          </View>
        )}

        {(data.account || data.extraAccounts.length > 0) && (
          <View style={{ flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }} wrap={false}>
            <View style={{ alignSelf: "flex-start" }}>
              {data.account && (
                <>
                  <View style={s.payBar}>
                    <Text style={[s.label, s.cell]}>{L.paymentDetails}</Text>
                  </View>
                  {accountRows(data.account).map(([k, v]) => (
                    <View key={k} style={s.row}>
                      <View style={s.kvKey}>
                        <Text style={s.body}>{k}</Text>
                      </View>
                      <Text style={[s.body, { maxWidth: payWidth - 95.6, paddingRight: 1.3 }]}>{v}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
            <View style={{ marginTop: 24.6, marginRight: 16 }}>
              {data.extraAccounts.map((a) => (
                <View key={a.label} style={s.box}>
                  <Text style={s.boxTitle}>{L.compactTitle(a.label)}</Text>
                  <Text style={s.boxText}>{L.compactNumber}</Text>
                  <Text style={[s.boxText, { marginBottom: 10.5 }]}>{a.accountNumber}</Text>
                  <Text style={s.boxText}>{L.compactName}</Text>
                  <Text style={s.boxText}>{a.accountName}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        </View>
      </Page>
    </Document>
  );
}
