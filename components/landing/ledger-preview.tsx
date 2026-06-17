import { seedLedger, truncateHash } from '@/core/audit'

const ledger = seedLedger().slice(0, 5)

export function LedgerPreview() {
  return (
    <div className="border border-ink/15 bg-card">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-mono">audit ledger · append-only</span>
        <span className="font-mono text-[0.6875rem] text-go">● intact</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline">
              <th className="label-mono px-4 py-2 font-normal">seq</th>
              <th className="label-mono px-4 py-2 font-normal">event</th>
              <th className="label-mono px-4 py-2 font-normal">hash</th>
              <th className="label-mono px-4 py-2 font-normal">prev</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.seq} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {e.seq.toString().padStart(2, '0')}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">
                  {e.type}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-accent">
                  {truncateHash(e.hash)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {truncateHash(e.prevHash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
