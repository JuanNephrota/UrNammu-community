"use client";

import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { MoreHorizontal, Eye, Pencil } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type SystemRow = {
  id: string;
  name: string;
  department: string;
  riskLevel: string;
  status: string;
  dataSensitivity: string;
  vendor: string | null;
  createdAt: string | Date;
  owner: { id: string; name: string | null };
  _count: { agents: number; riskAssessments: number };
  topRecommendation: string;
  topRecommendationTone: "critical" | "warning" | "success" | "info";
};

const columns: ColumnDef<SystemRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/registry/${row.original.id}`}
        className="font-medium text-[var(--accent)] hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "department",
    header: "Department",
  },
  {
    accessorKey: "owner.name",
    header: "Owner",
    cell: ({ row }) => row.original.owner.name ?? "—",
  },
  {
    accessorKey: "riskLevel",
    header: "Risk",
    cell: ({ row }) => (
      <Badge variant={riskBadgeVariant(row.original.riskLevel)}>
        {row.original.riskLevel}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusBadgeVariant(row.original.status)}>
        {row.original.status.replace("_", " ")}
      </Badge>
    ),
  },
  {
    accessorKey: "dataSensitivity",
    header: "Data",
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.dataSensitivity}</Badge>
    ),
  },
  {
    accessorKey: "_count.agents",
    header: "Agents",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original._count.agents}</span>
    ),
  },
  {
    accessorKey: "topRecommendation",
    header: "Next Best Action",
    cell: ({ row }) => (
      <Badge variant={row.original.topRecommendationTone}>
        {row.original.topRecommendation}
      </Badge>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-[var(--text-faint)]">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <Link href={`/registry/${row.original.id}`}>
            <DropdownMenuItem>
              <Eye className="mr-2 h-4 w-4" /> View
            </DropdownMenuItem>
          </Link>
          <Link href={`/registry/${row.original.id}/edit`}>
            <DropdownMenuItem>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
];

export function SystemsTable({ data }: { data: SystemRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search AI systems..."
    />
  );
}
