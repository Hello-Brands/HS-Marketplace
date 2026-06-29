export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  return (
    <div className="flex items-end gap-[2px] h-5" aria-hidden="true">
      {data.map((v, i) => (
        <span
          key={i}
          className="w-[5px] rounded-sm bg-hs-red-300"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
