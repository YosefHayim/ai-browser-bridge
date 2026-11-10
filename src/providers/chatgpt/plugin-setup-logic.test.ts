import { describe, expect, test } from "vitest";
import {
  type PluginSummary,
  readPluginNameFromRowText,
  readPluginSetupPlan,
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

describe("readPluginSetupPlan", () => {
  test("readPluginSetupPlan creates the plugin when no plugin has the connector name", () => {
    const plugins = [createPlugin({ name: "Gmail", serverUrl: null })];

    const setupPlan = readPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins,
    });

    expect(setupPlan).toEqual({ action: "create", pluginsToDelete: [] });
  });

  test("readPluginSetupPlan reuses a same-name plugin that has the current URL", () => {
    const plugins = [createPlugin({ serverUrl: CURRENT_URL })];

    const setupPlan = readPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins,
    });

    expect(setupPlan).toEqual({ action: "reuse", pluginsToDelete: [] });
  });

  test("readPluginSetupPlan deletes a same-name plugin with an old URL before creating it", () => {
    const stalePlugin = createPlugin({ serverUrl: OLD_URL });

    const setupPlan = readPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [stalePlugin],
    });

    expect(setupPlan).toEqual({ action: "replace", pluginsToDelete: [stalePlugin] });
  });

  test("readPluginSetupPlan never deletes a plugin with a different name", () => {
    const otherPlugin = createPlugin({ name: "ai-browser-bridge-old", serverUrl: OLD_URL });

    const setupPlan = readPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [otherPlugin],
    });

    expect(setupPlan).toEqual({ action: "create", pluginsToDelete: [] });
  });

  test("readPluginSetupPlan does not create a second plugin when the URL of a same-name plugin is unreadable", () => {
    const unreadablePlugin = createPlugin({ serverUrl: null });

    const setupPlan = readPluginSetupPlan({
      connectorName: CONNECTOR_NAME,
      connectorUrl: CURRENT_URL,
      plugins: [unreadablePlugin],
    });

    expect(setupPlan).toEqual({ action: "unreadable", pluginsToDelete: [] });
  });
});
