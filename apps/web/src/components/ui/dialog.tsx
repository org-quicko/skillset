import * as React from "react"
import type { ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2 after:absolute after:-inset-1.5 after:content-['']"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * A component rendering a single SVG icon, e.g. one from `lucide-react` or
 * `provider-icons`.
 *
 * @remarks
 * `React.ComponentType`, not a plain function type: a `lucide-react` icon is
 * a `ForwardRefExoticComponent`, which a plain `(props) => JSX.Element`
 * signature does not structurally accept.
 */
type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>

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
 * `FormDialogBody` rather than pushing the footer off-screen. The width is a
 * cap, not a fixed size (`max-w-[516px]`, not `w-[516px]`) — below the `sm`
 * breakpoint it shrinks with the viewport instead of overflowing a narrow
 * screen. Pass `className` to override it for a dialog whose content
 * genuinely needs more room (more, denser fields).
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
function FormDialog({
  open,
  onOpenChange,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Overrides the default `max-w-[516px] max-h-[640px]` sizing. */
  className?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("flex max-h-[640px] w-full max-w-[calc(100%-2rem)] flex-col gap-4 sm:max-w-[516px]", className)}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
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
function FormDialogHeader({
  icon: Icon,
  title,
  description,
}: {
  icon?: IconComponent
  title: ReactNode
  description?: ReactNode
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
  )
}

/**
 * A `FormDialog`'s scrollable field area — 32px below the header, 24px
 * between whatever it's given, and capped so `FormDialogFooter` always stays
 * on-surface instead of being pushed out by a long field list.
 *
 * @remarks
 * `overflow-y-auto` alone makes the browser compute `overflow-x` as `auto`
 * too (the CSS spec forces a non-`visible` pair when only one axis is set),
 * which clips a focused field's ring box-shadow against this element's own
 * edge. `px-1 -mx-1` gives the ring room to render without shifting the
 * fields' visual alignment with the header above.
 */
function FormDialogBody({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-hidden -mx-1 mt-4 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1">
      {children}
    </div>
  )
}

/** A `FormDialogFooter`'s primary action — the one thing besides Cancel that submits or confirms. */
interface FormDialogSubmitAction {
  label: string
  /** Shown instead of `label` while `pending`. Defaults to `"{label}…"`. */
  pendingLabel?: string
  pending?: boolean
  disabled?: boolean
  onClick: () => void
  /** `"destructive"` for an irreversible action (delete, remove). Defaults to `"default"`. */
  variant?: "default" | "destructive"
  /** Shown before `label`, only while not `pending`. */
  icon?: IconComponent
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
function FormDialogFooter({
  onCancel,
  cancelLabel = "Cancel",
  cancelDisabled,
  submit,
  children,
}: {
  onCancel?: () => void
  cancelLabel?: string
  /** Disables Cancel — for a dialog whose destructive action shouldn't be walked away from mid-request. */
  cancelDisabled?: boolean
  submit?: FormDialogSubmitAction
  children?: ReactNode
}) {
  const SubmitIcon = submit?.icon

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
  )
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
function FormField({
  htmlFor,
  label,
  trailing,
  helperText,
  children,
}: {
  htmlFor: string
  label: ReactNode
  trailing?: ReactNode
  helperText?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
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
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  FormDialog,
  FormDialogHeader,
  FormDialogBody,
  FormDialogFooter,
  FormField,
}
export type { FormDialogSubmitAction }
