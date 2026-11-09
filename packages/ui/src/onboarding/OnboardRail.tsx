// OnboardRail — the setup-context sidebar shown through the linear onboarding flow (every
// non-solo screen). It replaces the app's inert nav rail with a minimal three-phase
// progress tracker (Account → Storage → Live) driven by the current screen's phase. Solo
// screens (the host-join branch) render no rail; Onboarding gates that, so this component
// always has a phase to show.
//
// The step label is floored at --muted (never --faint) so it clears AA on the --bg-deep
// rail; see onboarding.css.

import { PHASES, SCREEN_META, type ScreenId, type ObState } from "./machine";
import { LOGO_SRC } from "./logo";

type StepStatus = "done" | "active" | "pending";

export function OnboardRail({ current }: { current: ScreenId; state: ObState }): JSX.Element {
  const curIdx = PHASES.indexOf(SCREEN_META[current].phase);

  return (
    <aside className="rail rail-pinned ob-rail" aria-label="Setup progress">
      <div className="rail-brand">
        <img src={LOGO_SRC} alt="Sharedock" />
      </div>

      <div className="ob-body">
        <ol className="psteps">
          {PHASES.map((phase, i) => {
            const status: StepStatus = i < curIdx ? "done" : i === curIdx ? "active" : "pending";
            return (
              <li className={`pstep ${status}`} key={phase} aria-current={status === "active" ? "step" : undefined}>
                <span className="rod" aria-hidden="true" />
                <span className="mk" aria-hidden="true" />
                <div>
                  <b>{phase}</b>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
