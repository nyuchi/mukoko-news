import type * as React from "react";

/**
 * Icon shim for Mzizi brand components.
 *
 * The canonical nyuchi-* components (mzizi_db → component_documents, N3 brand)
 * import icons from `@/lib/icons` so the icon library is swappable per app.
 * Mukoko News uses lucide-react, so this module just re-exports the set the
 * brand components need. Keeping the canonical import path means future
 * component syncs from the mzizi registry drop in without edits.
 */
export {
  AlertCircle,
  AlertTriangle,
  Award,
  Ban,
  BookOpen,
  Check,
  CheckCircle,
  Clock,
  Eye,
  Flower2,
  HelpCircle,
  Newspaper,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";

/** Prop surface the brand components rely on — any lucide icon satisfies it. */
export type BrandIcon = React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  strokeWidth?: number | string;
  color?: string;
}>;
