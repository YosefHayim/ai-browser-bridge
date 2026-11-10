import { errors, type Page } from "playwright";

export type FakeControl = {
  readonly name: string;
  readonly selector: string;
  readonly visible: boolean;
};

type ControlVisibility = {
  readonly visible: boolean;
};

type ControlWait = {
  readonly state: "visible";
  readonly timeout: number;
};

type FakeControlLocator = {
  readonly filter: (visibility: ControlVisibility) => FakeControlLocator;
  readonly first: () => FakeControlLocator;
  readonly count: () => Promise<number>;
  readonly isVisible: () => Promise<boolean>;
  readonly waitFor: (wait: ControlWait) => Promise<void>;
  readonly evaluate: () => Promise<void>;
};

type ControlLocatorDetails = {
  readonly matches: readonly FakeControl[];
  readonly clicks: string[];
};

const findExactControl = (controls: readonly FakeControl[]): FakeControl | undefined => {
  const hasMultipleControls = controls.length > 1;
  if (hasMultipleControls) {
    throw new Error(`strict mode violation: ${controls.length} controls match`);
  }

  const [onlyControl] = controls;
  return onlyControl;
};

const createControlLocator = (details: ControlLocatorDetails): FakeControlLocator => ({
  filter: (visibility) => {
    const filteredControls = details.matches.filter(
      (control) => control.visible === visibility.visible,
    );
    return createControlLocator({ matches: filteredControls, clicks: details.clicks });
  },
  first: () => {
    const firstControls = details.matches.slice(0, 1);
    return createControlLocator({ matches: firstControls, clicks: details.clicks });
  },
  count: async () => details.matches.length,
  isVisible: async () => {
    const exactControl = findExactControl(details.matches);
    return exactControl?.visible === true;
  },
  waitFor: async (wait) => {
    const exactControl = findExactControl(details.matches);

    const isVisibleRequested = exactControl?.visible === true;
    if (isVisibleRequested) return;

    throw new errors.TimeoutError(`Timeout ${wait.timeout}ms exceeded waiting for a control`);
  },
  evaluate: async () => {
    const exactControl = findExactControl(details.matches);

    const isControlMissing = exactControl == null;
    if (isControlMissing) throw new errors.TimeoutError("No control to click");

    details.clicks.push(exactControl.name);
  },
});

export const createFakeControlsPage = (controls: readonly FakeControl[]) => {
  const clicks: string[] = [];
  const page = {
    locator: (selector: string) => {
      const selectorParts = selector.split(", ");
      const hits = controls.filter((control) => selectorParts.includes(control.selector));
      return createControlLocator({ matches: hits, clicks });
    },
    getByRole: () => createControlLocator({ matches: [], clicks }),
  } as unknown as Page;

  return { page, clicks };
};
