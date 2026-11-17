interface CountUpNumberProps {
  value: number;
  text: string;
  class?: string;
  style?: string;
}

/** Shows the final number as text. The page script swaps in an animated count from 0 when it scrolls into view. */
export function CountUpNumber({ value, text, class: className, style }: CountUpNumberProps) {
  return (
    <span class={className} style={style} data-count-to={String(value)}>
      {text}
    </span>
  );
}
