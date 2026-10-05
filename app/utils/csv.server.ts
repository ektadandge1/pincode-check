export type CsvRow = Record<string, string>;

export function parseCsv(content: string): CsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    record.push(value.trim());
    value = "";
  };
  const pushRecord = () => {
    pushValue();
    if (record.some((field) => field.length > 0)) records.push(record);
    record = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      pushValue();
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      pushRecord();
    } else {
      value += char;
    }
  }

  if (inQuotes) throw new Error("CSV contains an unclosed quoted field.");
  if (value.length > 0 || record.length > 0) pushRecord();

  if (records.length < 2) {
    return [];
  }

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim().toLowerCase(),
  );
  if (headers.some((header) => !header)) throw new Error("CSV contains an empty column name.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");

  const rows: CsvRow[] = [];

  for (const values of records.slice(1)) {
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    rows.push(row);
  }

  return rows;
}
