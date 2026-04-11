"use client";

import { useState, useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  ColumnFiltersState,
  useReactTable,
  Column,
  Table,
} from "@tanstack/react-table";

function ColumnFilter({ column, table }: { column: Column<any, any>; table: Table<any> }) {
  const sortedUniqueValues = useMemo(() => {
    const vals = new Set<string>();
    table.getPreFilteredRowModel().rows.forEach((row) => {
      const v = row.getValue(column.id);
      if (v !== null && v !== undefined && v !== "") {
        vals.add(String(v));
      }
    });
    return Array.from(vals).sort().slice(0, 50);
  }, [column.id, table.getPreFilteredRowModel().rows]);

  const filterValue = column.getFilterValue() as string;

  // If boolean-like (true/false/Yes/No) or few unique values, use dropdown
  if (sortedUniqueValues.length <= 20) {
    return (
      <select
        value={filterValue ?? ""}
        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
        className="mt-1 px-1 py-0.5 border rounded text-[10px] w-full bg-white"
      >
        <option value="">All</option>
        {sortedUniqueValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  // For many unique values, use a datalist (searchable dropdown)
  const listId = `list-${column.id}`;
  return (
    <>
      <input
        list={listId}
        placeholder="Filter..."
        value={filterValue ?? ""}
        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
        className="mt-1 px-1 py-0.5 border rounded text-[10px] w-full"
      />
      <datalist id={listId}>
        {sortedUniqueValues.map((v) => (
          <option key={String(v)} value={String(v)} />
        ))}
      </datalist>
    </>
  );
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowAction?: (row: TData, action: string) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowAction,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: { sorting, columnFilters, globalFilter },
  });

  const activeFilters = columnFilters.length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <input
          placeholder="Search all columns..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="px-3 py-2 border rounded text-sm w-64"
        />
        {activeFilters > 0 && (
          <button
            onClick={() => setColumnFilters([])}
            className="text-xs text-[#ff3366] hover:underline"
          >
            Clear {activeFilters} filter{activeFilters > 1 ? "s" : ""}
          </button>
        )}
        <span className="text-xs text-zinc-400 ml-auto">
          {table.getFilteredRowModel().rows.length} of {data.length} rows
        </span>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100 text-left">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="p-2">
                    <div
                      className={`flex items-center gap-1 ${
                        header.column.getCanSort() ? "cursor-pointer select-none" : ""
                      }`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="font-medium text-xs">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {header.column.getIsSorted() === "asc" ? (
                        <span className="text-[#ff3366]">↑</span>
                      ) : header.column.getIsSorted() === "desc" ? (
                        <span className="text-[#ff3366]">↓</span>
                      ) : null}
                    </div>
                    {header.column.getCanFilter() && (
                      <ColumnFilter column={header.column} table={table} />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t hover:bg-zinc-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.getRowModel().rows.length === 0 && (
          <p className="text-zinc-400 text-center py-8 text-sm">No results</p>
        )}
      </div>
    </div>
  );
}
