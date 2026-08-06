/**
 * Effect Schema definitions for the domain feature.
 *
 * These schemas are the single source of truth for runtime validation of
 * domain types. Pure TypeScript interfaces in `types/` remain for structural
 * typing; these schemas add encode/decode + validation at boundaries.
 */

import { Schema } from "effect";

/**
 * Schema for the permission mode governing MCP tool access.
 */
export const PermissionModeSchema = Schema.Literal("read-only", "ask", "auto");
