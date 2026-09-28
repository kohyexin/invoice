import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-control border bg-overlay/[0.03] px-3.5 text-sm text-ink",
          "placeholder:text-ink-soft transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-offset-0",
          invalid
            ? "border-danger focus:border-danger focus:ring-danger/25"
            : "border-overlay/10 focus:border-brand focus:ring-brand/25",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-ink", className)}
      {...props}
    />
  );
}
