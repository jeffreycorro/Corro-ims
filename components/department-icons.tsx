import type { DepartmentSlug } from "@/lib/departments";

type IconProps = {
  className?: string;
};

function IconFrame({ children, className }: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function DepartmentIcon({
  slug,
  className = "h-6 w-6",
}: {
  slug: DepartmentSlug;
  className?: string;
}) {
  switch (slug) {
    case "admin":
      return (
        <IconFrame className={className}>
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9 20v-6h6v6" />
        </IconFrame>
      );
    case "technical":
      return (
        <IconFrame className={className}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-1.8-1.8 2-2.1Z" />
        </IconFrame>
      );
    case "finance":
      return (
        <IconFrame className={className}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v10M9.5 9.5c.6-1 1.6-1.5 2.5-1.5s2 .6 2 1.8-1 1.7-2.4 2.1c-1.4.4-2.6.8-2.6 2.2s1.2 2 2.6 2 2.2-.6 2.6-1.5" />
        </IconFrame>
      );
    case "procurement":
      return (
        <IconFrame className={className}>
          <path d="M4 7h16l-1.2 11.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 7Z" />
          <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
        </IconFrame>
      );
    case "motorpool":
      return (
        <IconFrame className={className}>
          <path d="M4 13h16l-1.5-5.2A2 2 0 0 0 16.6 6H7.4a2 2 0 0 0-1.9 1.8L4 13Z" />
          <path d="M5 17h14M7 17v2M17 17v2M4 13v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </IconFrame>
      );
    case "safety":
      return (
        <IconFrame className={className}>
          <path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 8.5 4.2-1.3 7-4.3 7-8.5V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </IconFrame>
      );
    case "site":
      return (
        <IconFrame className={className}>
          <path d="M4 20h16M6 20V10l6-4 6 4v10" />
          <path d="M10 20v-5h4v5M9 13h.01M15 13h.01" />
        </IconFrame>
      );
    case "hr":
      return (
        <IconFrame className={className}>
          <circle cx="9" cy="8" r="2.4" />
          <circle cx="16" cy="9" r="2" />
          <path d="M4.5 18c.4-2.6 2.4-4 4.6-4s4.2 1.4 4.6 4" />
          <path d="M13.2 14.2c1.6-.5 3.5.1 4.3 2.3" />
        </IconFrame>
      );
    default:
      return null;
  }
}
