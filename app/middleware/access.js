import { fail } from './errors.js';

export function signedIn(viewer) {
  if (!viewer.auth.id) fail(401, 'Sign in first.');
}
export function watcher(viewer) {
  signedIn(viewer);
  if (!viewer.auth.canWatch) fail(402, 'Choose a plan to watch.');
}
export function administrator(viewer) {
  signedIn(viewer);
  if (viewer.auth.role !== 'admin') fail(403, 'Admin access only.');
}
export function headAdmin(viewer) {
  administrator(viewer);
  if (!viewer.auth.isHead) fail(403, 'Head Admin access only.');
}
