import { useEffect, useRef, type InputHTMLAttributes } from "react";

type SkinColorInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value: string;
  onChange: (hex: string) => void;
};

/**
 * Native `<input type="color">` that React does not overwrite while focused.
 * Chromium closes the RGB/HSL picker if a controlled `value` is written back
 * on each keystroke.
 */
export function SkinColorInput({
  value,
  onChange,
  ...rest
}: SkinColorInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || focusedRef.current) return;
    if (el.value !== value) el.value = value;
  }, [value]);

  return (
    <input
      {...rest}
      ref={inputRef}
      type="color"
      defaultValue={value}
      onFocus={(e) => {
        focusedRef.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        rest.onBlur?.(e);
      }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
