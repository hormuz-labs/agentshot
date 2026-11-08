import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-amber text-on-amber hover:bg-amber-hover shadow-[0_2px_0_rgb(0_0_0/0.18)]',
        secondary: 'bg-raised text-fg border border-line hover:bg-hover',
        ghost: 'text-dim hover:text-fg hover:bg-hover',
        danger: 'text-bad hover:bg-bad/10',
      },
      size: { sm: 'h-7 px-2.5 text-xs', md: 'h-8 px-3 text-[13px]', lg: 'h-10 px-4 text-sm', icon: 'size-8', iconSm: 'size-7' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'
