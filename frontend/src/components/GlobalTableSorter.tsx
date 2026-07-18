import { useEffect } from "react";

type SortDirection = "asc" | "desc";

const ACTION_HEADER_RE = /^(actions?|edit|archive|view|select)$/i;

const getCellText = (cell: Element | undefined) =>
  (cell?.textContent || "").replace(/\s+/g, " ").trim();

const parseDateValue = (value: string) => {
  const text = value.trim();
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseComparable = (value: string): string | number => {
  const text = value.trim();
  if (!text || text === "-" || text === "\u2014" || /^n\/a$/i.test(text)) return "";

  const dateValue = parseDateValue(text);
  if (dateValue !== null) return dateValue;

  const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]);

  const numericText = text.replace(/[%\u00a3,$,\s]/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(numericText)) return Number(numericText);

  return text.toLowerCase();
};

const compareValues = (a: string | number, b: string | number, direction: SortDirection) => {
  const dir = direction === "asc" ? 1 : -1;

  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  }) * dir;
};

const getHeaderLeafIndex = (table: HTMLTableElement, target: HTMLTableCellElement) => {
  const rows = Array.from(table.tHead?.rows || []);
  const grid: Array<Array<HTMLTableCellElement | null>> = [];

  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ||= [];
    let columnIndex = 0;

    Array.from(row.cells).forEach((cell) => {
      while (grid[rowIndex][columnIndex]) columnIndex += 1;

      const rowSpan = cell.rowSpan || 1;
      const colSpan = cell.colSpan || 1;
      for (let r = 0; r < rowSpan; r += 1) {
        grid[rowIndex + r] ||= [];
        for (let c = 0; c < colSpan; c += 1) {
          grid[rowIndex + r][columnIndex + c] = cell as HTMLTableCellElement;
        }
      }

      columnIndex += colSpan;
    });
  });

  const lastRow = grid[grid.length - 1] || [];
  const directIndex = lastRow.findIndex((cell) => cell === target);
  if (directIndex >= 0) return directIndex;

  for (let index = 0; index < lastRow.length; index += 1) {
    const columnStack = grid.map((row) => row[index]);
    if (columnStack.includes(target)) return index;
  }

  return target.cellIndex;
};

const sortTable = (table: HTMLTableElement, header: HTMLTableCellElement) => {
  const headerText = getCellText(header);
  if (!headerText || ACTION_HEADER_RE.test(headerText)) return;

  const body = table.tBodies[0];
  if (!body || body.rows.length < 2) return;

  const columnIndex = getHeaderLeafIndex(table, header);
  const currentField = table.dataset.sortColumn;
  const currentDir = (table.dataset.sortDir as SortDirection | undefined) || "asc";
  const nextDir: SortDirection =
    currentField === String(columnIndex) && currentDir === "asc" ? "desc" : "asc";

  const rows = Array.from(body.rows).map((row, index) => ({
    row,
    index,
    value: parseComparable(getCellText(row.cells[columnIndex])),
    fallback: getCellText(row.cells[0]).toLowerCase(),
  }));

  rows.sort((a, b) => {
    const result = compareValues(a.value, b.value, nextDir);
    if (result !== 0) return result;

    const fallback = a.fallback.localeCompare(b.fallback, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (fallback !== 0) return fallback;

    return a.index - b.index;
  });

  rows.forEach(({ row }) => body.appendChild(row));

  table.dataset.sortColumn = String(columnIndex);
  table.dataset.sortDir = nextDir;
  table.querySelectorAll("th[data-global-sort-active]").forEach((cell) => {
    cell.removeAttribute("data-global-sort-active");
    cell.removeAttribute("data-global-sort-dir");
  });
  header.dataset.globalSortActive = "true";
  header.dataset.globalSortDir = nextDir;
};

const decorateSortableHeaders = () => {
  document.querySelectorAll("table th").forEach((cell) => {
    const header = cell as HTMLTableCellElement;
    const headerText = getCellText(header);
    if (!headerText || ACTION_HEADER_RE.test(headerText) || header.hasAttribute("aria-label")) {
      header.removeAttribute("data-global-sortable");
      return;
    }

    header.dataset.globalSortable = "true";
  });
};

export default function GlobalTableSorter() {
  useEffect(() => {
    decorateSortableHeaders();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, a, input, select, textarea, [role='button']")) return;

      const header = target.closest("th") as HTMLTableCellElement | null;
      const table = header?.closest("table") as HTMLTableElement | null;
      if (!header || !table) return;

      sortTable(table, header);
    };

    const observer = new MutationObserver(() => decorateSortableHeaders());
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", handleClick);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return null;
}
