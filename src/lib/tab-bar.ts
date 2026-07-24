// Listing detail pages render their own fixed bottom contact bar
// (h-cta-spacer); stacking the tab bar under it would double the chrome, so
// the tab bar hides itself there.
export function tabBarHiddenForPath(pathname: string): boolean {
  return pathname.startsWith("/listings/")
}
