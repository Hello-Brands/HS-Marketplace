// Version of the disclaimer/FDD a seller acknowledges on the add-listing gate.
// Bump deliberately when the fee terms change so the audit log records which
// version applied. Kept OUT of disclaimer-actions.ts because that file is a
// "use server" module, which may only export async functions — exporting this
// constant from there breaks `next build`.
export const FDD_VERSION = "2026"
