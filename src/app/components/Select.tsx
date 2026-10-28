import type { ChangeEventHandler, SelectHTMLAttributes } from "react";
import { Field } from "./Field";
import styles from "./controls.module.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "value" | "onChange"
> & {
  id: string;
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: ChangeEventHandler<HTMLSelectElement>;
  hint?: string;
  error?: string;
  placeholder?: string;
};

export function Select({
  id,
  label,
  value,
  options,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  required,
  ...selectProps
}: SelectProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      <select
        {...selectProps}
        className={`${styles.control} ${styles.select}`}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
