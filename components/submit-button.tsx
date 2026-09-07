"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
};

export function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  className,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending || props.disabled} className={className} {...props}>
      {pending ? pendingLabel : children}
    </button>
  );
}
