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

type ControlLocatorInput = {
  readonly matches: readonly FakeControl[];
  readonly clicks: string[];
};

const findStrictMatch = (matches: readonly FakeControl[]): FakeControl | undefined => {
  const hasMultipleMatches = matches.length > 1;
  if (hasMultipleMatches) {
    throw new Error(`strict mode violation: ${matches.length} controls match`);
  }

  const [onlyMatch] = matches;
  return onlyMatch;
};

const createControlLocator = (input: ControlLocatorInput): FakeControlLocator => ({
  filter: (visibility) => {
    const filteredMatches = input.matches.filter(
      (control) => control.visible === visibility.visible,
    );
    return createControlLocator({ matches: filteredMatches, clicks: input.clicks });
  },
  first: () => {
    const firstMatches = input.matches.slice(0, 1);
    return createControlLocator({ matches: firstMatches, clicks: input.clicks });
  },
  count: async () => input.matches.length,
  isVisible: async () => {
    const strictMatch = findStrictMatch(input.matches);
    return strictMatch?.visible === true;
  },
  waitFor: async (wait) => {
    const strictMatch = findStrictMatch(input.matches);
    const isVisibleRequested = strictMatch?.visible === true;
    if (isVisibleRequested) return;

    throw new errors.TimeoutError(`Timeout ${wait.timeout}ms exceeded waiting for a control`);
  },
  evaluate: async () => {
    const strictMatch = findStrictMatch(input.matches);
    const isMatchMissing = strictMatch === undefined;
    if (isMatchMissing) throw new errors.TimeoutError("No control to click");

    input.clicks.push(strictMatch.name);
  },
});

export const createFakeControlsPage = (controls: readonly FakeControl[]) => {
  const clicks: string[] = [];
  const page = {
    locator: (selector: string) => {
      const selectorParts = selector.split(", ");
      const matches = controls.filter((control) => selectorParts.includes(control.selector));
      return createControlLocator({ matches, clicks });
    },
    getByRole: () => createControlLocator({ matches: [], clicks }),
  } as unknown as Page;
  return { page, clicks };
};
