import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The Seed of Life, turning — this app's one loading indicator.
 *
 * ## Why it animates the real mark rather than drawing one
 *
 * The mark is `public/mukoko-mark-full-{light,dark}.svg` and the doctrine on it
 * is absolute: never recolour a petal, reorder the ring, add a gradient or
 * shadow, or substitute a mono reduction. So this does not redraw the artwork
 * in JSX — inlining the seven polygons here would be a second copy free to
 * drift from the files every other surface renders. It renders those files and
 * animates the *transform* of the boxes around them, which cannot touch a fill.
 *
 * The rotation is a full 360°, not the 60° the six-fold geometry would allow.
 * Sixty degrees loops seamlessly in shape but lands cobalt where gold was, so
 * the ring appears to change colour as it turns; a full turn returns every
 * mineral to its own cell.
 *
 * ## Why it does not use `AppIcon`
 *
 * `AppIcon` picks its file with `useTheme()`, and this app's `useTheme` THROWS
 * outside a `ThemeProvider`. A spinner is mounted by skeletons, empty states
 * and tests — surfaces that have no reason to carry a theme provider — so
 * building on it would make `ThemeProvider` a hard requirement of all of them.
 * That is the coupling the nav sidebar's "no theme toggle in the panel" note
 * exists to avoid. Both files are rendered instead and the `.dark` class picks
 * one in pure CSS, which also means no hydration flash: the correct mark is in
 * the first paint rather than one frame after it.
 *
 * Both images are `aria-hidden`. The wrapper announces only when given a
 * `label`; inside a skeleton that already carries `role="status"` a second live
 * region would make a screen reader say the same thing twice, so decorative is
 * the default.
 */
interface MukokoSpinnerProps {
  /** Rendered size in px. Defaults to `--icon-xl` (40px). */
  size?: number;
  /**
   * Announced to assistive tech. Omit inside a container that already has
   * `role="status"` — the spinner is then decorative.
   */
  label?: string;
  className?: string;
}

export function MukokoSpinner({ size = 40, label, className }: MukokoSpinnerProps) {
  return (
    <span
      className={cn("mukoko-spinner inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "status", "aria-live": "polite" } : { "aria-hidden": true })}
    >
      <span className="mukoko-spinner-turn inline-flex items-center justify-center">
        <span className="mukoko-spinner-breathe inline-flex items-center justify-center">
          <Image
            src="/mukoko-mark-full-light.svg"
            alt=""
            width={size}
            height={size}
            className="object-contain dark:hidden"
            aria-hidden="true"
          />
          <Image
            src="/mukoko-mark-full-dark.svg"
            alt=""
            width={size}
            height={size}
            className="hidden object-contain dark:block"
            aria-hidden="true"
          />
        </span>
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
