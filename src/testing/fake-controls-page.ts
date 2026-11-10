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

const findStrictHit = (hits: readonly FakeControl[]): FakeControl | undefined => {
  const hasMultipleHits = hits.length > 1;
  if (hasMultipleHits) {
    throw new Error(`strict mode violation: ${hits.length} controls match`);
  }

  const [onlyHit] = hits;
  return onlyHit;
};

const createControlLocator = (details: ControlLocatorDetails): FakeControlLocator => ({
  filter: (visibility) => {
    const filteredHits = details.matches.filter(
      (control) => control.visible === visibility.visible,
    );
    return createControlLocator({ matches: filteredHits, clicks: details.clicks });
  },
  first: () => {
    const firstHits = details.matches.slice(0, 1);
    return createControlLocator({ matches: firstHits, clicks: details.clicks });
  },
  count: async () => details.matches.length,
  isVisible: async () => {
    const strictHit = findStrictHit(details.matches);
    return strictHit?.visible === true;
  },
  waitFor: async (wait) => {
    const strictHit = findStrictHit(details.matches);
    const isVisibleRequested = strictHit?.visible === true;
    if (isVisibleRequested) return;

    throw new errors.TimeoutError(`Timeout ${wait.timeout}ms exceeded waiting for a control`);
  },
  evaluate: async () => {
    const strictHit = findStrictHit(details.matches);
    const isHitMissing = strictHit == null;
    if (isHitMissing) throw new errors.TimeoutError("No control to click");

    details.clicks.push(strictHit.name);
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
