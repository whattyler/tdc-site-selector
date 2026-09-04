/**
 * Minimal RFC 4180 CSV reader, enough for docs/assumptions.csv.
 *
 * Handles quoted fields, escaped quotes, embedded commas and newlines, and
 * CRLF. Deliberately dependency-free: this runs in the seed script and in the
 * Vercel build, and one more package in that path is one more thing to pin.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become part
  // of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      sawAnyChar = true;
    } else if (char === ",") {
      endField();
      sawAnyChar = true;
    } else if (char === "\r") {
      // Consumed with the \n that follows it.
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
      sawAnyChar = true;
    }
  }

  // A trailing newline should not produce a phantom final row.
  if (sawAnyChar || field !== "" || row.length > 0) endRow();

  return rows;
}

/** Parse into objects keyed by the header row. */
export function parseCsvRecords(input: string): Record<string, string>[] {
  const rows = parseCsv(input).filter(
    (row) => row.length > 1 || (row[0] ?? "").trim() !== "",
  );
  if (rows.length === 0) return [];

  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = row[index] ?? "";
    });
    return record;
  });
}
