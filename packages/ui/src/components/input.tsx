import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const inputVariants = cva(
  "h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "border-input",
        /**
         * Edit in place: reads as the text around it until you point at it.
         * For a field that *is* the content, such as a title in a header, where
         * a permanent box would frame a heading like a form control.
         *
         * Text that outgrows the box is trimmed with an ellipsis while the
         * field sits idle, the way the heading it stands in for would be:
         * a hard cut mid-letter reads as a rendering fault. Focus hands it
         * back to the browser, which scrolls the field as the caret moves,
         * so the whole value stays reachable.
         */
        ghost:
          "border-transparent font-medium text-ellipsis hover:border-input dark:bg-transparent dark:hover:bg-input/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
