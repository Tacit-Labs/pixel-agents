// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
export const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

/** The activity line a permission prompt produces, from any of its three paths. */
export const PERMISSION_ACTIVITY_TEXT = 'Needs approval';

/**
 * Which of the panel's two lines gets the large type (Tacit patch).
 *
 * A labelled session — every session in this fork's office, where `applyLabel`
 * names the avatar for its director, role and job — leads with that name and
 * demotes what it is running to the small line underneath. Across two dozen
 * characters the name is what tells a director whose work they are looking at;
 * a shell command truncated to fit a panel tells them nothing they can act on,
 * and reading one at the largest size on every avatar at once is the noise this
 * removes.
 *
 * Two exceptions, both states that ask the director for something. "Needs
 * approval" and "Waiting for input" are not tool chatter, and demoting them
 * would bury the one line on the panel worth acting on — so they keep the large
 * line and the name steps down instead.
 *
 * An unlabelled session is unchanged from upstream: with no name there is
 * nothing else the first line could carry.
 */
export function nameLeadsPanel(label: string | null, activityText: string): boolean {
  if (!label) return false;
  return activityText !== PERMISSION_ACTIVITY_TEXT && activityText !== WAITING_INPUT_ACTIVITY_TEXT;
}
