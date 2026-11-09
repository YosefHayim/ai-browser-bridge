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

const strictMatch = (matches: readonly FakeControl[]): FakeControl | undefined => {
  if (matches.length > 1) {
    throw new Error(`strict mode violation: ${matches.length} controls match`);
  }
  const [onlyMatch] = matches;
  return onlyMatch;
};

const controlLocator = (input: ControlLocatorInput): FakeControlLocator => ({
  filter: (visibility) => {
    const filteredMatches = input.matches.filter(
      (control) => control.visible === visibility.visible,
    );
    return controlLocator({ matches: filteredMatches, clicks: input.clicks });
  },
  first: () => {
    const firstMatches = input.matches.slice(0, 1);
    return controlLocator({ matches: firstMatches, clicks: input.clicks });
  },
  count: async () => input.matches.length,
  isVisible: async () => {
    const match = strictMatch(input.matches);
    return match?.visible === true;
  },
  waitFor: async (wait) => {
    const match = strictMatch(input.matches);
    if (match?.visible === true) return;
    throw new errors.TimeoutError(`Timeout ${wait.timeout}ms exceeded waiting for a control`);
  },
  evaluate: async () => {
    const match = strictMatch(input.matches);
    if (match === undefined) throw new errors.TimeoutError("No control to click");
    input.clicks.push(match.name);
  },
});

export const fakeControlsPage = (controls: readonly FakeControl[]) => {
  const clicks: string[] = [];
  const page = {
    locator: (selector: string) => {
      const selectorParts = selector.split(", ");
      const matches = controls.filter((control) => selectorParts.includes(control.selector));
      return controlLocator({ matches, clicks });
    },
    getByRole: () => controlLocator({ matches: [], clicks }),
  } as unknown as Page;
  return { page, clicks };
};
