export const CopyIcon = () => (
  <>
    <svg
      class="copy-icon copy-icon-idle"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"
        stroke="currentColor"
        stroke-width="1.4"
      />
    </svg>
    <svg
      class="copy-icon copy-icon-done"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span class="visually-hidden" role="status" aria-live="polite" data-copy-status />
  </>
);
