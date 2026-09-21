export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string
  hint?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10.5px] font-semibold tracking-[0.07em] text-muted-foreground">
        {title.toUpperCase()}
      </span>
      <div className="flex-1" />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {action}
    </div>
  )
}
