import { describe, expect, test } from "vitest";
import {
  type PluginSummary,
  pickCreateDialogErrorLine,
  pickPluginSetupPlan,
  readPluginNameFromRowText,
  readServerUrlFromText,
} from "./plugin-setup-logic.ts";

const CONNECTOR_NAME = "ai-browser-bridge";
const CURRENT_URL = "https://new-tunnel.example.test/mcp";
const OLD_URL = "https://old-tunnel.example.test/mcp";

const createPlugin = (details: Partial<PluginSummary>): PluginSummary => ({
  name: CONNECTOR_NAME,
  detailUrl: "https://chatgpt.com/plugins/plugin_example",
  serverUrl: CURRENT_URL,
  ...details,
});

describe("readPluginNameFromRowText", () => {
  test("readPluginNameFromRowText returns the first line of a plugin row", () => {
    const rowText = "ai-browser-bridge\nLocal repo tools";

    const pluginName = readPluginNameFromRowText(rowText);

    expect(pluginName).toBe("ai-browser-bridge");
  });

  test("readPluginNameFromRowText returns an empty name for a blank row", () => {
    const rowText = "   ";

    const pluginName = readPluginNameFromRowText(rowText);

    expect(pluginName).toBe("");
  });
});

describe("readServerUrlFromText", () => {
  test("readServerUrlFromText returns the connector URL when the page shows it", () => {
    const pageText = `ai-browser-bridge\nServer URL ${CURRENT_URL}\nUninstall`;

    const serverUrl = readServerUrlFromText({ text: pageText, connectorUrl: CURRENT_URL });

    expect(serverUrl).toBe(CURRENT_URL);
  });

  test("readServerUrlFromText returns the other server URL when the page shows an old one", () => {
    const pageText = `ai-browser-bridge\nServer URL ${OLD_URL}\nUninstall`;

    const serverUrl = readServerUrlFromText({ text: pageText, connectorUrl: CURRENT_URL });

    expect(serverUrl).toBe(OLD_URL);
  });

  test("readServerUrlFromText ignores ChatGPT and OpenAI links", () => {
    const pageText = "Learn more at https://help.openai.com/en/articles/plugins";

    const serverUrl = readServerUrlFromText({ text: pageText, connectorUrl: CURRENT_URL });

    expect(serverUrl).toBeNull();
  });
});

describe("pickPluginSetupPlan", () => {
  test("pickPluginSetupPlan creates the plugin when no plugin has the connector name", () => {
    const plugins = [createPlugin({ name: "Gmail", serverUrl: null })];

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins,
    });

    expect(setupPlan).toEqual({ action: "create", pluginsToDelete: [] });
  });

  test("pickPluginSetupPlan reuses a same-name plugin that has the current URL", () => {
    const plugins = [createPlugin({ serverUrl: CURRENT_URL })];

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins,
    });

    expect(setupPlan).toEqual({ action: "reuse", pluginsToDelete: [] });
  });

  test("pickPluginSetupPlan deletes a same-name plugin with an old URL before creating it", () => {
    const stalePlugin = createPlugin({ serverUrl: OLD_URL });

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [stalePlugin],
    });

    expect(setupPlan).toEqual({ action: "replace", pluginsToDelete: [stalePlugin] });
  });

  test("pickPluginSetupPlan never deletes a plugin with a different name", () => {
    const otherPlugin = createPlugin({ name: "ai-browser-bridge-old", serverUrl: OLD_URL });

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [otherPlugin],
    });

    expect(setupPlan).toEqual({ action: "create", pluginsToDelete: [] });
  });

  test("pickPluginSetupPlan does not create a second plugin when the URL of a same-name plugin is unreadable", () => {
    const unreadablePlugin = createPlugin({ serverUrl: null });

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [unreadablePlugin],
    });

    expect(setupPlan).toEqual({ action: "unreadable", pluginsToDelete: [] });
  });

  test("pickPluginSetupPlan replaces every same-name plugin, even one that has the current URL", () => {
    const currentPlugin = createPlugin({ serverUrl: CURRENT_URL });
    const staleDuplicate = createPlugin({
      detailUrl: "https://chatgpt.example.test/plugins/2",
      serverUrl: OLD_URL,
    });

    const setupPlan = pickPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [currentPlugin, staleDuplicate],
    });

    expect(setupPlan).toEqual({
      action: "replace",
      pluginsToDelete: [currentPlugin, staleDuplicate],
    });
  });
});

describe("pickCreateDialogErrorLine", () => {
  test("pickCreateDialogErrorLine returns the name clash message ChatGPT shows under the trust warning", () => {
    const dialogText = [
      "Add custom MCP server",
      "Only connect to MCP servers you trust. An untrusted server may access or steal information.",
      "An app with this name already exists. Choose another name",
      "Read the guide",
      "Cancel",
      "Create as a plugin",
    ].join("\n");

    const errorLine = pickCreateDialogErrorLine(dialogText);

    expect(errorLine).toBe("An app with this name already exists. Choose another name");
  });

  test("pickCreateDialogErrorLine returns null when the dialog shows no message under the trust warning", () => {
    const dialogText = [
      "Only connect to MCP servers you trust. An untrusted server may access or steal information.",
      "Read the guide",
      "Cancel",
    ].join("\n");

    const errorLine = pickCreateDialogErrorLine(dialogText);

    expect(errorLine).toBeNull();
  });

  test("pickCreateDialogErrorLine returns null when the dialog has no trust warning", () => {
    const errorLine = pickCreateDialogErrorLine("Add custom MCP server\nName\nCancel");

    expect(errorLine).toBeNull();
  });
});
