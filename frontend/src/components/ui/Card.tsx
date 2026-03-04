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
          bg-white dark:bg-slate-800
          border border-gray-100 dark:border-slate-700
          rounded-xl shadow-sm
          ${hover ? "hover:shadow-md hover:border-gray-200 dark:hover:border-slate-600 transition-all" : ""}
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

// Card sub-components for consistent internal layout
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
      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
        {children}
      </h3>
      {subtitle && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {subtitle}
        </p>
      )}
    </div>
  );
}
