const QUESTIONS = [
  {
    question: "Do I need API keys?",
    answer:
      "No. The bridge drives the chat apps in your logged-in Chrome, so every request runs on your own account and plan.",
  },
  {
    question: "What does it run on?",
    answer: "macOS today, with Node 24 or newer and Google Chrome.",
  },
  {
    question: "What if a chat app changes its page?",
    answer: "Each provider keeps its selectors in one browser layer, so a fix stays in one place.",
  },
  {
    question: "Can a chat app run commands on my Mac?",
    answer:
      "No. There is no shell. Repo tools are a fixed set, checked and kept inside the repo, under the permission mode you pick.",
  },
  {
    question: "Where is my data kept?",
    answer:
      "On your Mac. The Chrome profile lives in ~/.ai-browser-bridge/chrome-profile and repo state in .bridge/ inside the repo.",
  },
];

export const FaqList = () => (
  <div class="faq">
    <div class="sec-head reveal">
      <h2 class="h2">Questions</h2>
    </div>
    <div class="qa reveal">
      {QUESTIONS.map((item, index) => (
        <details name="faq" open={index === 0 ? true : undefined} key={item.question}>
          <summary>
            {item.question}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  </div>
);
