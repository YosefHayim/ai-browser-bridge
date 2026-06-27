import { fillFirstVisible } from "../dom/fill-first-visible.ts";
import type { ConnectorSetupContext } from "./connector.types.ts";

/** Context for {@link fillConnectorUrlField}. */
export interface FillConnectorUrlFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Fill the connector URL field and record a setup step when successful. */
export async function fillConnectorUrlField(ctx: FillConnectorUrlFieldContext): Promise<boolean> {
  const filledUrl = await fillFirstVisible({
    page: ctx.setup.page,
    selectors: [
      'input[name="custom-connector-url"]',
      '#custom-connector-url',
      'input[type="url"]',
      'input[name*="url" i]',
      'input[placeholder*="https://" i]',
      'input[placeholder*="url" i]',
      'textarea[name*="url" i]',
      'textarea[placeholder*="https://" i]',
    ],
    value: ctx.setup.connectorUrl,
  });
  if (filledUrl) ctx.setup.result.steps.push(`Filled connector URL: ${ctx.setup.connectorUrl}`);
  return filledUrl;
}

/** Context for {@link fillConnectorNameField}. */
export interface FillConnectorNameFieldContext {
  /** Connector setup context with page and result accumulator. */
  setup: ConnectorSetupContext;
}

/** Fill the connector name field and record a setup step when successful. */
export async function fillConnectorNameField(ctx: FillConnectorNameFieldContext): Promise<void> {
  const filledName = await fillFirstVisible({
    page: ctx.setup.page,
    selectors: [
      'input[name="custom-connector-name"]',
      '#custom-connector-name',
      'input[name*="name" i]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
    ],
    value: ctx.setup.connectorName,
  });
  if (filledName) ctx.setup.result.steps.push(`Filled connector name: ${ctx.setup.connectorName}`);
}

/** Fill connector URL and name fields in the creation form. */
export async function fillConnectorFormFields(ctx: ConnectorSetupContext): Promise<boolean> {
  if (!await fillConnectorUrlField({ setup: ctx })) return false;
  await fillConnectorNameField({ setup: ctx });
  return true;
}
