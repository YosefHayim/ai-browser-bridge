/**
 * MCP SDK still requires Zod shapes at the registration wire. Effect Schema is
 * the app SSOT; convert via JSONSchema.make → z.fromJSONSchema so tool defs
 * never author Zod. This is the only module that may import `zod`.
 */
import { JSONSchema, type Schema } from "effect";
import { z } from "zod";

/** Raw shape passed as `McpServer.registerTool(…, { inputSchema }, …)`. */
export type McpZodShape = Record<string, z.ZodType>;

export const effectSchemaToMcpShape = <A, I, R>(schema: Schema.Schema<A, I, R>): McpZodShape => {
  const json = JSONSchema.make(schema) as {
    $schema?: string;
    type?: string;
    properties?: Record<string, unknown>;
  };
  if (json.properties === undefined || Object.keys(json.properties).length === 0) {
    return {};
  }

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
