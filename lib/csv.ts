// Minimal CSV parser + column auto-mapping for the "import from QuickBooks/SAP
// export" integration. Runs in the browser (no server upload needed).

// Parse CSV text into rows of string cells. Handles quoted fields, escaped
// quotes (""), and CRLF. Drops fully-empty rows.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export interface ColumnMap {
  product: number
  counterparty: number
  destination: number
}

// Auto-detect which columns hold product / counterparty / destination by header
// name. Returns -1 for a field whose column couldn't be found.
export function autoMapColumns(headers: string[]): ColumnMap {
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h.trim()))
  return {
    product: find(/product|item|description|service|goods|commodity/i),
    counterparty: find(/customer|company|counterparty|buyer|consignee|client|party|name/i),
    destination: find(/country|destination|ship.*to|deliver|region/i),
  }
}

export interface OrderRow {
  product: string
  counterparty: string
  destination: string
}

// Apply a column map to data rows (excludes the header row).
export function rowsToOrders(rows: string[][], map: ColumnMap): OrderRow[] {
  const out: OrderRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const product = map.product >= 0 ? (r[map.product] ?? '').trim() : ''
    const counterparty = map.counterparty >= 0 ? (r[map.counterparty] ?? '').trim() : ''
    const destination = map.destination >= 0 ? (r[map.destination] ?? '').trim() : ''
    if (product && counterparty) out.push({ product, counterparty, destination })
  }
  return out
}

// A QuickBooks-style invoice export, for the "download sample" affordance.
export const SAMPLE_CSV = `Customer,Product/Service,Ship To Country
Bremer Elektronik GmbH,Consumer notebook computer 14-inch retail,Germany (DE)
Hikvison Digital,High-resolution thermal IR surveillance camera module,United Arab Emirates (AE)
Mahan Air,Aircraft turbine engine components,Iran (IR)
Hannover Tech Distribution,Network routing equipment enterprise grade,Germany (DE)
Gulf Avionics Trading,Radar apparatus,United Arab Emirates (AE)
`
