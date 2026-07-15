import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-button,12px)] text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary/90',
        destructive: 'bg-destructive text-on-destructive hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-on-accent',
        secondary: 'bg-secondary text-on-secondary hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-on-accent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Heights are the Mzizi touch-target minimums (globals.css). The default
      // rides --density-touch, so a data-density="compact" ancestor (admin,
      // dashboard) shrinks buttons without any per-component class changes.
      size: {
        default: 'min-h-[var(--density-touch)] px-4 py-2',
        sm: 'min-h-[var(--touch-compact)] px-3',
        lg: 'min-h-[var(--touch-hero)] px-8',
        icon: 'min-h-[var(--density-touch)] min-w-[var(--density-touch)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
