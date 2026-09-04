import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A component rendering a single SVG icon, e.g. one from `lucide-react` or
 * `provider-icons`.
 *
 * @remarks
 * `React.ComponentType`, not a plain function type: a `lucide-react` icon is
 * a `ForwardRefExoticComponent`, which a plain `(props) => JSX.Element`
 * signature does not structurally accept.
 */
type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

/**
 * The fixed-size surface every "create or edit one thing" dialog in the
 * Registry is built from — `FormDialogHeader`, `FormDialogBody`, and
 * `FormDialogFooter` compose inside it. A plain `DialogContent` wrapper
 * otherwise: it owns no state and reads no fields.
 *
 * @remarks
 * 516×640 is the house size, sized for a handful of labeled fields — wide
 * enough that two side-by-side inputs (e.g. Client ID / Client secret) don't
 * feel cramped, capped in height so a long field list scrolls inside
 * `FormDialogBody` rather than pushing the footer off-screen. Pass
 * `className` to override it for a dialog whose content genuinely needs more
 * room (more, denser fields).
 *
 * @example
 * ```tsx
 * <FormDialog open={open} onOpenChange={onOpenChange}>
 *   <FormDialogHeader title="Add a User" description="..." />
 *   <FormDialogBody>...</FormDialogBody>
 *   <FormDialogFooter submit={{ label: "Create User", onClick: handleSubmit }} />
 * </FormDialog>
 * ```
 */
export function FormDialog({
  open,
  onOpenChange,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Overrides the default `w-[516px] max-h-[640px]` sizing. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("flex max-h-[640px] w-[516px] max-w-[516px] flex-col gap-4 sm:max-w-[516px]", className)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A `FormDialog`'s header: an optional leading brand icon beside the title,
 * then a description line explaining what the dialog is for.
 *
 * @example
 * ```tsx
 * <FormDialogHeader
 *   icon={GithubIcon}
 *   title="Add GitHub app"
 *   description="An app you've already registered on GitHub…"
 * />
 * ```
 */
export function FormDialogHeader({
  icon: Icon,
  title,
  description,
}: {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <DialogHeader>
      {Icon ? (
        <div className="flex items-center gap-2.5">
          <Icon className="size-6 shrink-0" />
          <DialogTitle>{title}</DialogTitle>
        </div>
      ) : (
        <DialogTitle>{title}</DialogTitle>
      )}
      {description && <DialogDescription>{description}</DialogDescription>}
    </DialogHeader>
  );
}

/**
 * A `FormDialog`'s scrollable field area — 32px below the header, 24px
 * between whatever it's given, and capped so `FormDialogFooter` always stays
 * on-surface instead of being pushed out by a long field list.
 */
export function FormDialogBody({ children }: { children: ReactNode }) {
  return <div className="scrollbar-hidden mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">{children}</div>;
}

/** A `FormDialogFooter`'s primary action — the one thing besides Cancel that submits or confirms. */
export interface FormDialogSubmitAction {
  label: string;
  /** Shown instead of `label` while `pending`. Defaults to `"{label}…"`. */
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** `"destructive"` for an irreversible action (delete, remove). Defaults to `"default"`. */
  variant?: "default" | "destructive";
  /** Shown before `label`, only while not `pending`. */
  icon?: IconComponent;
}

/**
 * A `FormDialog`'s footer: a ghost Cancel plus one primary or destructive
 * action, borderless and on the same surface as the rest of the dialog —
 * never the shadcn `DialogFooter` default's divider and tinted background.
 *
 * @remarks
 * Pass `children` instead of `submit` for a footer that isn't Cancel-plus-one
 * action — e.g. the single "Done" button a success state shows once a User
 * has been created and there is nothing left to confirm.
 *
 * @example
 * ```tsx
 * <FormDialogFooter
 *   onCancel={() => handleOpenChange(false)}
 *   submit={{
 *     label: "Delete Skill",
 *     pendingLabel: "Deleting…",
 *     pending: deleteSkill.isPending,
 *     disabled: confirmation !== name,
 *     variant: "destructive",
 *     onClick: () => deleteSkill.mutate({ id, name }),
 *   }}
 * />
 * ```
 */
export function FormDialogFooter({
  onCancel,
  cancelLabel = "Cancel",
  cancelDisabled,
  submit,
  children,
}: {
  onCancel?: () => void;
  cancelLabel?: string;
  /** Disables Cancel — for a dialog whose destructive action shouldn't be walked away from mid-request. */
  cancelDisabled?: boolean;
  submit?: FormDialogSubmitAction;
  children?: ReactNode;
}) {
  const SubmitIcon = submit?.icon;

  return (
    <DialogFooter className="border-t-0 bg-transparent">
      {children ?? (
        <>
          {onCancel && (
            <Button type="button" variant="ghost" disabled={cancelDisabled} onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          {submit && (
            <Button
              type="button"
              variant={submit.variant}
              disabled={submit.disabled || submit.pending}
              onClick={submit.onClick}
            >
              {SubmitIcon && !submit.pending && <SubmitIcon />}
              {submit.pending ? (submit.pendingLabel ?? `${submit.label}…`) : submit.label}
            </Button>
          )}
        </>
      )}
    </DialogFooter>
  );
}

/**
 * One labeled field inside a `FormDialogBody`: a `Label`, the control itself,
 * and optionally a right-aligned bit of trailing content beside the label
 * (e.g. a character counter) and a line of helper text below the control.
 *
 * @remarks
 * For a field with more going on below it than one line of muted text — chips,
 * a conditional warning, anything that isn't `Label` / control / helper — skip
 * this and lay the block out by hand instead of fighting the shape.
 *
 * @example
 * ```tsx
 * <FormField htmlFor="integration_display_name" label="Display name">
 *   <Input id="integration_display_name" value={displayName} onChange={...} />
 * </FormField>
 * ```
 */
export function FormField({
  htmlFor,
  label,
  trailing,
  helperText,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  trailing?: ReactNode;
  helperText?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {trailing ? (
        <div className="flex items-center justify-between">
          <Label htmlFor={htmlFor}>{label}</Label>
          {trailing}
        </div>
      ) : (
        <Label htmlFor={htmlFor}>{label}</Label>
      )}
      {children}
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
    </div>
  );
}
