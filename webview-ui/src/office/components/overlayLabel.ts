// Both turn-end states show the green checkmark bubble. A finished turn (Stop)
// shows ONLY the checkmark (the label falls through to its normal idle text);
// going idle waiting on the user (Notification(idle_prompt)) additionally
// surfaces this label. Driven by Character.waitingAwaitingInput.
export const WAITING_INPUT_ACTIVITY_TEXT = 'Waiting for input';

/** The activity line a permission prompt produces, from any of its three paths. */
export const PERMISSION_ACTIVITY_TEXT = 'Needs approval';

/** What AskUserQuestion formats to. Named here for the same reason as the two
 *  above — it asks the director for something — and because it is the one
 *  status whose first word ("Waiting") would survive shortening while losing
 *  the whole point of the sentence. */
export const ASK_ACTIVITY_TEXT = 'Waiting for your answer';

/** The fields that decide whether a character carries an operator label. */
export interface PanelLabelInputs {
  agentName?: string;
  isTeamLead?: boolean;
  teamName?: string;
  leadAgentId?: number;
}

/**
 * The operator label, or null for a character that has none (Tacit patch).
 *
 * `agentName` carries two unrelated things. Upstream uses it for an Agent
 * Teams role — `web-researcher` under a `LEAD` badge — and this fork's
 * `applyLabel` reuses the same field for the operator label it builds from
 * the hook's director, role and job. That server-side function refuses on any
 * team-shaped agent, and this mirrors the same test, so nothing below ever
 * reorders or shortens a team panel: upstream's team UI keeps upstream's
 * layout and its full wording, which is also what its e2e specs assert.
 */
export function operatorLabel(ch: PanelLabelInputs): string | null {
  if (ch.isTeamLead || ch.teamName || ch.leadAgentId !== undefined) return null;
  return ch.agentName ?? null;
}

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
 * Three exceptions, all states that ask the director for something. "Needs
 * approval", "Waiting for input" and "Waiting for your answer" are not tool
 * chatter, and demoting them would bury the one line on the panel worth acting
 * on — so they keep the large line and the name steps down instead.
 *
 * An unlabelled session is unchanged from upstream: with no name there is
 * nothing else the first line could carry.
 */
export function nameLeadsPanel(label: string | null, activityText: string): boolean {
  if (!label) return false;
  return (
    activityText !== PERMISSION_ACTIVITY_TEXT &&
    activityText !== WAITING_INPUT_ACTIVITY_TEXT &&
    activityText !== ASK_ACTIVITY_TEXT
  );
}

/**
 * The demoted line, cut to one word (Tacit patch).
 *
 * The full status is written to be read at the top of a panel on its own —
 * `Running: cd ~/tacit-claude/.claude/worktrees/…`, `Reading officeState.ts`.
 * Under a name, on a phone, that is a line of noise ending in an ellipsis:
 * long enough to crowd the panel, cut too early to identify anything. One word
 * still answers the only question the second line is being asked, which is
 * what kind of work is happening — `Running`, `Reading`, `Editing`,
 * `Searching`.
 *
 * The cut is deliberately generic rather than a table of tool names: it takes
 * the text before the first colon, then its first word, so it follows any
 * provider's phrasing without a second copy of that provider's vocabulary
 * living here to drift. `Running: cd …` → `Running`, `Subtask: audit deps` →
 * `Subtask`, `Searching files` → `Searching`, `Idle` → `Idle`.
 *
 * Only ever applied to the demoted line. The three states above never reach it
 * (they lead, in full), and neither does a sub-agent's subtask title, which is
 * a description rather than a status and reads as gibberish at one word.
 */
export function shortActivityText(status: string): string {
  const beforeColon = status.split(':', 1)[0] ?? '';
  const firstWord = beforeColon.trim().split(/\s+/)[0] ?? '';
  return firstWord || status;
}
