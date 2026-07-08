import { cn } from "@/lib/utils"

/**
 * Inline field-level error text - the ONLY sanctioned companion to a
 * red (aria-invalid) field. Renders nothing when there is no message,
 * so callers can keep it permanently mounted:
 *
 *   <Input aria-invalid={!!error} aria-describedby={error ? id : undefined} />
 *   <InlineFieldError id={id} message={error} />
 */
function InlineFieldError({
  message,
  id,
  className,
}: {
  message?: string | null
  id?: string
  className?: string
}) {
  if (!message) return null
  return (
    <p id={id} role="alert" className={cn("text-xs text-destructive", className)}>
      {message}
    </p>
  )
}

export { InlineFieldError }
