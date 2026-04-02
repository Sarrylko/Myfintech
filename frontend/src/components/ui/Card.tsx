import { type HTMLAttributes, forwardRef } from "react";

type Padding = "none" | "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding;
  hover?: boolean;
}

const paddingClasses: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = "md", hover = false, children, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          bg-card
          border border-border-subtle
          rounded-xl shadow-card
          ${hover ? "hover:shadow-md hover:border-border transition-all duration-150 cursor-pointer" : ""}
          ${paddingClasses[padding]}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

export function CardHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between mb-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  subtitle,
  className = "",
}: {
  children: React.ReactNode;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="font-semibold text-content-primary text-sm">
        {children}
      </h3>
      {subtitle && (
        <p className="text-xs text-content-muted mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}
