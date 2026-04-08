import { authHandlers } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const { GET, POST, PUT, PATCH, DELETE } = authHandlers;
