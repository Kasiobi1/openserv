/** Deterministic messy invoice texts plus the ground truth they encode. Lets the buyer's task be real and checkable. */
export interface Invoice {
  invoiceNumber: string;
  vendor: string;
  date: string; // YYYY-MM-DD
  total: number;
  currency: string;
}

const VENDORS = ["Acme Ltd", "Globex Corporation", "Initech", "Umbrella Supplies", "Hooli Cloud", "Soylent Foods"];
const CURRENCIES: [code: string, symbol: string][] = [["USD", "$"], ["USD", "$"], ["EUR", "€"], ["GBP", "£"], ["USD", "$"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p2 = (n: number) => String(n).padStart(2, "0");

export function makeInvoices(count = 20): { truth: Invoice[]; texts: string[] } {
  const truth: Invoice[] = [];
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 6, 1 + ((i * 3) % 60)));
    const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    const [code, sym] = CURRENCIES[i % CURRENCIES.length]!;
    const inv: Invoice = {
      invoiceNumber: `INV-${3000 + i * 7}`,
      vendor: VENDORS[(i * 5 + 2) % VENDORS.length]!,
      date: `${y}-${p2(m + 1)}-${p2(day)}`,
      total: (12_000 + ((i * 7919) % 480_000)) / 100,
      currency: code,
    };
    truth.push(inv);
    const t = money(inv.total);
    switch (i % 4) {
      case 0: texts.push(`INVOICE ${inv.invoiceNumber}\nVendor: ${inv.vendor}\nIssued: ${p2(day)} ${MONTHS[m]} ${y}\nAmount due: ${code} ${t}`); break;
      case 1: texts.push(`${inv.vendor} | Tax Invoice #${inv.invoiceNumber}\nDate: ${y}/${p2(m + 1)}/${p2(day)}\nTOTAL ${sym}${t}`); break;
      case 2: texts.push(`Inv No. ${inv.invoiceNumber}\nBilled by ${inv.vendor} on ${p2(day)}-${MONTHS[m]}-${y}\nGrand total: ${t} ${code}`); break;
      default: texts.push(`From: ${inv.vendor}\nRef: ${inv.invoiceNumber}\nDated ${LONG_MONTHS[m]} ${day}, ${y}\nBalance due ${sym}${t}`);
    }
  }
  return { truth, texts };
}
