/**
 * MCP SDK still requires Zod shapes at the registration wire. This is the only
 * place that may import `zod`: Effect Schema is the app SSOT; we convert via
 * `JSONSchema.make` → `z.fromJSONSchema` so tool defs never author Zod.
 */
import { JSONSchema, type Schema } from "effect";
import { z } from "zod";

/** Raw shape passed as `McpServer.registerTool(…, { inputSchema }, …)`. */
export type McpZodShape = Record<string, z.ZodType>;

/**
 * Convert an Effect `Schema.Struct` (or empty struct) into a Zod raw shape for
 * MCP tool registration.
 *
 * @param schema - Effect Schema describing the tool's arguments object.
 * @returns A Zod raw shape (`{ field: z.string(), … }`) for the MCP SDK.
 * @example
 * ```ts
 * mcp.registerTool("read_file", { description: desc, inputSchema: effectSchemaToMcpShape(ReadFileArgsSchema) }, handler);
 * ```
 */
export const effectSchemaToMcpShape = <A, I, R>(schema: Schema.Schema<A, I, R>): McpZodShape => {
  const json = JSONSchema.make(schema) as {
    $schema?: string;
    type?: string;
    properties?: Record<string, unknown>;
  };
  const properties = json.properties ?? {};
  if (Object.keys(properties).length === 0) return {};

  const { $schema: _schema, ...rest } = json as Record<string, unknown> & { $schema?: string };
  const objectSchema = z.fromJSONSchema(rest);
  if (
    typeof objectSchema === "object" &&
    objectSchema !== null &&
    "shape" in objectSchema &&
    typeof objectSchema.shape === "object" &&
    objectSchema.shape !== null
  ) {
    return objectSchema.shape as McpZodShape;
  }
  throw new Error("MCP tool args schema must decode to a JSON object with properties.");
};
