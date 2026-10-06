import { useRef, type RefObject } from "react";
import { EmojiPickerPopover } from "../actions/EmojiPickerPopover";

interface Props {
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement>;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Shares selection/caret behavior across messages and attachment captions. */
export function ComposerEmojiPicker({ inputRef, onChange, disabled, className }: Props) {
  const caret = useRef<number | null>(null);
  return (
    <EmojiPickerPopover
      mode="compose"
      disabled={disabled}
      className={className}
      onSelect={(emoji) => {
        const input = inputRef.current;
        if (!input || input.disabled) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        caret.current = start + emoji.length;
        onChange(input.value.slice(0, start) + emoji + input.value.slice(end));
      }}
      onCloseAutoFocus={(event) => {
        if (caret.current === null) return;
        event.preventDefault();
        const position = caret.current;
        caret.current = null;
        // Wait for the controlled value to commit before restoring the caret.
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input?.isConnected || input.disabled) return;
          input.focus();
          input.setSelectionRange(position, position);
        });
      }}
    />
  );
}
