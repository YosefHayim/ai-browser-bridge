const FADE_OUT_MS = 500;
const SEEN_THRESHOLD = 0.2;

interface DemoPlayer {
  start: () => void;
  stop: () => void;
}

function readBeatTimes(card: HTMLElement): number[] {
  return (card.dataset.beatTimes ?? "")
    .split(",")
    .filter((time) => time !== "")
    .map(Number);
}

function createDemoPlayer(card: HTMLElement): DemoPlayer {
  const loopMs = Number(card.dataset.loopMs);
  const beatTimes = readBeatTimes(card);
  const timedElements = [...card.querySelectorAll<HTMLElement>("[data-at]")];
  let timerIds: number[] = [];

  function showBeat(beat: number) {
    for (const element of timedElements) {
      const startBeat = Number(element.dataset.at);
      const endBeat = element.dataset.until == null ? Infinity : Number(element.dataset.until);
      element.toggleAttribute("data-shown", beat >= startBeat && beat < endBeat);
    }
  }

  function resetWithoutTransitions() {
    card.setAttribute("data-resetting", "");
    card.removeAttribute("data-fading");
    showBeat(0);
    void card.offsetWidth;
    card.removeAttribute("data-resetting");
  }

  function clearTimers() {
    for (const timerId of timerIds) clearTimeout(timerId);
    timerIds = [];
  }

  function playLoop() {
    resetWithoutTransitions();
    beatTimes.forEach((time, index) => {
      timerIds.push(window.setTimeout(() => showBeat(index + 1), time));
    });
    timerIds.push(
      window.setTimeout(() => card.setAttribute("data-fading", ""), loopMs - FADE_OUT_MS),
    );
    timerIds.push(window.setTimeout(playLoop, loopMs));
  }

  return {
    start: () => {
      clearTimers();
      playLoop();
    },
    stop: clearTimers,
  };
}

export function connectFeatureDemos() {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-demo]")];
  const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isObserverMissing = typeof IntersectionObserver === "undefined";
  if (isReducedMotion || isObserverMissing) return;

  const players = new Map<Element, DemoPlayer>();
  for (const card of cards) {
    card.setAttribute("data-armed", "");
    players.set(card, createDemoPlayer(card));
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const player = players.get(entry.target);
        if (player == null) continue;
        if (entry.isIntersecting) {
          entry.target.setAttribute("data-seen", "");
          player.start();
        } else {
          player.stop();
        }
      }
    },
    { threshold: SEEN_THRESHOLD },
  );
  for (const card of cards) observer.observe(card);
}
