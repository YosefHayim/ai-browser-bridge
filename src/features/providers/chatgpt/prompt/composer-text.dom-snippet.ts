/** In-page script that reads trimmed composer text from `#prompt-textarea`. */
export const READ_COMPOSER_TEXT_SNIPPET =
  '() => (document.querySelector("#prompt-textarea")?.innerText ?? "").trim()';
