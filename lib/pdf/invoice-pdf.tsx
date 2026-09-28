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

const SYMBOL: Record<string, string> = { USD: "$", HKD: "HK$", CNY: "¥", EUR: "€", SGD: "S$" };
const INK = "#1F2937";
const MUTED = "#6B7280";
const RULE = "#D1D5DB";
const ACCENT = "#1E40AF";

const num = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/** Accounting style: negatives in parentheses, zero as a dash. */
function acc(n: number, digits = 2) {
  if (Math.abs(n) < 0.005) return "-";
  return n < 0 ? `(${num(-n, digits)})` : num(n, digits);
}

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansSC", fontSize: 9, color: INK, paddingTop: 36, paddingBottom: 40, paddingHorizontal: 44, lineHeight: 1.35 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  issuerName: { fontSize: 13, fontWeight: 700, lineHeight: 1.5, marginBottom: 2 },
  muted: { color: MUTED },
  logo: { width: 150, height: 48, objectFit: "contain", objectPositionX: "right" } as never,
  label: { color: MUTED, fontSize: 8.5 },
  bold: { fontWeight: 700 },
  row: { flexDirection: "row" },
  meta: { flexDirection: "row", marginTop: 26 },
  due: { fontSize: 20, fontWeight: 700, color: ACCENT, textAlign: "right", lineHeight: 1.4 },
  tableHead: { flexDirection: "row", borderTopWidth: 2, borderTopColor: ACCENT, marginTop: 26, paddingTop: 5, paddingBottom: 4 },
  line: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: RULE },
  cDesc: { flex: 1, paddingRight: 8 },
  cRate: { width: 90, textAlign: "right" },
  cQty: { width: 50, textAlign: "right" },
  cTotal: { width: 95, textAlign: "right" },
  totals: { alignSelf: "flex-end", width: 250, marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  dueRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, marginTop: 3, borderTopWidth: 1, borderTopColor: INK },
  section: { marginTop: 22 },
  sectionTitle: { fontWeight: 700, fontSize: 10, marginBottom: 4 },
  kv: { flexDirection: "row", paddingVertical: 1.5 },
  kvKey: { width: 110, color: MUTED },
  kvVal: { flex: 1 },
  compact: { marginTop: 12, padding: 8, borderWidth: 0.5, borderColor: RULE, borderRadius: 3, width: 260 },
});

function Money({ value, currency, bold }: { value: number; currency: string; bold?: boolean }) {
  return (
    <Text style={bold ? s.bold : undefined}>
      {SYMBOL[currency] ?? currency} {acc(value)}
    </Text>
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

  return (
    <Document title={`Invoice ${data.number}`} author={data.issuer.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={{ maxWidth: 300 }}>
            <Text style={s.issuerName}>{data.issuer.name}</Text>
            {data.issuer.addressLines.map((l, i) => (
              <Text key={i} style={s.muted}>
                {l}
              </Text>
            ))}
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {data.issuer.logo && <Image src={data.issuer.logo} style={s.logo} />}
        </View>

        <View style={s.meta}>
          <View style={{ flex: 1.3, paddingRight: 12 }}>
            <Text style={s.label}>{L.billedTo}</Text>
            <Text style={s.bold}>{data.billTo.name}</Text>
            {data.billTo.attention ? <Text>{data.billTo.attention}</Text> : null}
            {data.billTo.lines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
          </View>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.label}>{L.invoiceNumber}</Text>
            <Text style={[s.bold, { marginBottom: 6 }]}>{data.number}</Text>
            {data.reference ? (
              <>
                <Text style={s.label}>{L.reference}</Text>
                <Text>{data.reference}</Text>
              </>
            ) : null}
          </View>
          <View style={{ flex: 0.9, paddingRight: 12 }}>
            <Text style={s.label}>{L.dateOfIssue}</Text>
            <Text style={{ marginBottom: 6 }}>{data.invoiceDate}</Text>
            {data.dueDate ? (
              <>
                <Text style={s.label}>{L.dueDate}</Text>
                <Text>{data.dueDate}</Text>
              </>
            ) : null}
          </View>
          <View style={{ flex: 1.2 }}>
            <Text style={[s.label, { textAlign: "right" }]}>{L.amountDue(headline.currency)}</Text>
            <Text style={s.due}>
              {SYMBOL[headline.currency] ?? headline.currency}
              {num(headline.amount)}
            </Text>
          </View>
        </View>

        <View style={s.tableHead}>
          <Text style={[s.cDesc, s.label]}>{L.description}</Text>
          <Text style={[s.cRate, s.label]}>{L.rate}</Text>
          <Text style={[s.cQty, s.label]}>{L.qty}</Text>
          <Text style={[s.cTotal, s.label]}>{L.lineTotal}</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={s.line} wrap={false}>
            <View style={s.cDesc}>
              <Text style={s.bold}>{l.description}</Text>
              {l.detail ? <Text style={s.muted}>{l.detail}</Text> : null}
            </View>
            <View style={s.cRate}>
              <Money value={l.rate} currency={data.currency} />
            </View>
            <Text style={s.cQty}>{num(l.quantity, 3)}</Text>
            <View style={s.cTotal}>
              <Money value={l.amount} currency={data.currency} />
            </View>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          {(
            [
              [L.subtotal, data.subtotal],
              [L.tax, data.tax],
              [L.total, data.total],
              [L.amountPaid, data.amountPaid],
            ] as const
          ).map(([k, v]) => (
            <View key={k} style={s.totalRow}>
              <Text style={s.muted}>{k}</Text>
              <Money value={v} currency={data.currency} />
            </View>
          ))}
          <View style={s.dueRow}>
            <Text style={s.bold}>{L.amountDue(data.currency)}</Text>
            <Money value={amountDue} currency={data.currency} bold />
          </View>
          {data.alt && (
            <View style={s.totalRow}>
              <Text style={s.bold}>{L.amountDue(data.alt.currency)}</Text>
              <Money value={data.alt.amount} currency={data.alt.currency} bold />
            </View>
          )}
        </View>

        {data.terms.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>{L.terms}</Text>
            {data.terms.map((t, i) => (
              <Text key={i}>{t}</Text>
            ))}
          </View>
        )}

        {(data.account || data.extraAccounts.length > 0) && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>{L.paymentDetails}</Text>
            {data.account &&
              accountRows(data.account).map(([k, v]) => (
                <View key={k} style={s.kv}>
                  <Text style={s.kvKey}>{k}</Text>
                  <Text style={s.kvVal}>{v}</Text>
                </View>
              ))}
            {data.extraAccounts.map((a) => (
              <View key={a.label} style={s.compact}>
                <Text style={[s.bold, { marginBottom: 3 }]}>{L.compactTitle(a.label)}</Text>
                <View style={s.kv}>
                  <Text style={{ width: 90, color: MUTED }}>{L.compactNumber}</Text>
                  <Text>{a.accountNumber}</Text>
                </View>
                <View style={s.kv}>
                  <Text style={{ width: 90, color: MUTED }}>{L.compactName}</Text>
                  <Text>{a.accountName}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
