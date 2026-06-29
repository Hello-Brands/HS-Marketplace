export type UnitState = "active" | "closed" | "none"
export type OverallStatus = "active" | "closed" | "pending"

export type LocationStatus = {
  suite: UnitState
  flagship: UnitState
  overall: OverallStatus
  label: string
}

type DateFields = {
  actualSuiteGoDate: Date | null
  suiteClosedDate: Date | null
  actualFlagshipGoDate: Date | null
  flagshipClosedDate: Date | null
}

/** A go date with no closed date => active; a closed date => closed; neither => none. */
function unitState(goDate: Date | null, closedDate: Date | null): UnitState {
  if (closedDate) return "closed"
  if (goDate) return "active"
  return "none"
}

/**
 * Derive a location's status purely from its suite/flagship go + closed dates.
 * Active (suite and/or flagship) wins; otherwise closed if anything closed;
 * otherwise pending (in the directory but not yet open).
 */
export function deriveLocationStatus(row: DateFields): LocationStatus {
  const suite = unitState(row.actualSuiteGoDate, row.suiteClosedDate)
  const flagship = unitState(row.actualFlagshipGoDate, row.flagshipClosedDate)

  const suiteActive = suite === "active"
  const flagshipActive = flagship === "active"
  const anyClosed = suite === "closed" || flagship === "closed"

  let overall: OverallStatus
  let label: string
  if (suiteActive && flagshipActive) {
    overall = "active"
    label = "Active suite + flagship"
  } else if (suiteActive) {
    overall = "active"
    label = "Active suite"
  } else if (flagshipActive) {
    overall = "active"
    label = "Active flagship"
  } else if (anyClosed) {
    overall = "closed"
    label = "Closed"
  } else {
    overall = "pending"
    label = "Pending"
  }

  return { suite, flagship, overall, label }
}
